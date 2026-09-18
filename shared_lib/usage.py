"""
Daily usage rollups - Cosmos-backed.

Every subsystem can call ``record_daily`` after an LLM / embedding /
invocation call to accumulate daily totals into the ``telemetry_daily``
container (PK ``/tenant_id``). Admin reads back via ``query_daily`` for
the telemetry dashboard.

This file is intentionally tiny - process-local in-flight counters belong
in each subsystem; only committed totals land here.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .storage import (
    ContainerSpec,
    bootstrap,
    get_container,
    is_cosmos_enabled,
)

logger = logging.getLogger(__name__)

CONTAINER_NAME = "telemetry_daily"
TELEMETRY_CONTAINER = ContainerSpec(CONTAINER_NAME, "/tenant_id")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _doc_id(tenant_id: str, day: str, user_id: str, subsystem: str) -> str:
    return f"{tenant_id}:{day}:{user_id or 'unknown'}:{subsystem}"


def _empty_doc(
    tenant_id: str, day: str, user_id: str, subsystem: str
) -> Dict[str, Any]:
    return {
        "id": _doc_id(tenant_id, day, user_id, subsystem),
        "tenant_id": tenant_id,
        "day": day,
        "user_id": user_id or "unknown",
        "subsystem": subsystem,
        "llm": {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
        "embedding": {
            "calls": 0,
            "vectors": 0,
            "total_tokens": 0,
        },
        "actions": {},
        "updated_at": _now(),
    }


def ensure_bootstrapped() -> bool:
    """Idempotently create the telemetry_daily container.

    No-op when Cosmos isn't configured. Safe to call from any subsystem at
    startup; the lifespan already does this - the helper exists so analyzer-
    side calls don't crash if admin hasn't booted first.
    """
    if not is_cosmos_enabled():
        return False

    try:
        bootstrap([TELEMETRY_CONTAINER])
        return True
    except Exception:  # noqa: BLE001
        logger.exception("[shared_lib.usage] telemetry_daily bootstrap failed")
        return False


def record_daily(
    *,
    tenant_id: str,
    user_id: str,
    subsystem: str,
    day: Optional[str] = None,
    llm: Optional[Dict[str, int]] = None,
    embedding: Optional[Dict[str, int]] = None,
    actions: Optional[Dict[str, int]] = None,
) -> bool:
    """Increment today's rollup for ``(tenant, user, subsystem)``.

    All counter args are sparse - only the fields present are added.
    Returns ``True`` on success, ``False`` when Cosmos isn't configured
    (caller should treat this as best-effort).
    """
    if not is_cosmos_enabled():
        return False

    if not tenant_id or not subsystem:
        logger.debug(
            "[shared_lib.usage] missing tenant_id/subsystem; skipping rollup"
        )
        return False

    day = day or _today_utc()

    try:
        container = get_container(CONTAINER_NAME)
    except RuntimeError:
        if not ensure_bootstrapped():
            return False
        container = get_container(CONTAINER_NAME)

    from azure.cosmos.exceptions import CosmosResourceNotFoundError

    doc_id = _doc_id(tenant_id, day, user_id, subsystem)

    try:
        doc = container.read_item(
            item=doc_id,
            partition_key=tenant_id,
        )
    except CosmosResourceNotFoundError:
        doc = _empty_doc(tenant_id, day, user_id, subsystem)
    except Exception:  # noqa: BLE001
        logger.exception(
            "[shared_lib.usage] rollup read failed id=%s",
            doc_id,
        )
        return False

    if llm:
        bucket = doc.setdefault(
            "llm",
            _empty_doc(tenant_id, day, user_id, subsystem)["llm"],
        )
        for k, v in llm.items():
            try:
                bucket[k] = int(bucket.get(k, 0)) + int(v or 0)
            except (TypeError, ValueError):
                continue

    if embedding:
        bucket = doc.setdefault(
            "embedding",
            _empty_doc(tenant_id, day, user_id, subsystem)["embedding"],
        )
        for k, v in embedding.items():
            try:
                bucket[k] = int(bucket.get(k, 0)) + int(v or 0)
            except (TypeError, ValueError):
                continue

    if actions:
        bucket = doc.setdefault("actions", {})
        for k, v in actions.items():
            try:
                bucket[k] = int(bucket.get(k, 0)) + int(v or 0)
            except (TypeError, ValueError):
                continue

    doc["updated_at"] = _now()

    try:
        container.upsert_item(doc)
        return True
    except Exception:  # noqa: BLE001
        logger.exception(
            "[shared_lib.usage] rollup upsert failed id=%s",
            doc_id,
        )
        return False


def query_daily(
    *,
    tenant_id: str,
    from_day: Optional[str] = None,
    to_day: Optional[str] = None,
    user_id: Optional[str] = None,
    subsystem: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return rolled-up rows for ``tenant_id`` within ``[from_day, to_day]``.

    All filters are optional; ``from_day`` and ``to_day`` are inclusive ISO
    dates (``YYYY-MM-DD``). Returns ``[]`` when Cosmos isn't configured.
    """
    if not is_cosmos_enabled():
        return []

    container = get_container(CONTAINER_NAME)

    sql = "SELECT * FROM c WHERE c.tenant_id = @t"
    params: List[Dict[str, Any]] = [
        {"name": "@t", "value": tenant_id}
    ]

    if from_day:
        sql += " AND c.day >= @from"
        params.append({"name": "@from", "value": from_day})

    if to_day:
        sql += " AND c.day <= @to"
        params.append({"name": "@to", "value": to_day})

    if user_id:
        sql += " AND c.user_id = @u"
        params.append({"name": "@u", "value": user_id})

    if subsystem:
        sql += " AND c.subsystem = @s"
        params.append({"name": "@s", "value": subsystem})

    sql += " ORDER BY c.day DESC"

    return list(
        container.query_items(
            query=sql,
            parameters=params,
            partition_key=tenant_id,
        )
    )


def aggregate_daily(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Sum up a list of rollup rows into a single totals envelope.

    Useful for the admin dashboard ``card`` view.
    """
    totals: Dict[str, Any] = {
        "rows": len(rows),
        "llm": {
            "calls": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
        "embedding": {
            "calls": 0,
            "vectors": 0,
            "total_tokens": 0,
        },
        "actions": {},
        "by_subsystem": {},
        "by_user": {},
    }

    for row in rows:
        llm = row.get("llm") or {}
        for k in totals["llm"]:
            try:
                totals["llm"][k] += int(llm.get(k, 0) or 0)
            except (TypeError, ValueError):
                continue

        embedding = row.get("embedding") or {}
        for k in totals["embedding"]:
            try:
                totals["embedding"][k] += int(embedding.get(k, 0) or 0)
            except (TypeError, ValueError):
                continue

        actions = row.get("actions") or {}
        for k, v in actions.items():
            try:
                totals["actions"][k] = (
                    int(totals["actions"].get(k, 0)) + int(v or 0)
                )
            except (TypeError, ValueError):
                continue

        subsystem = row.get("subsystem") or "unknown"
        user_id = row.get("user_id") or "unknown"

        subsystem_total = totals["by_subsystem"].setdefault(
            subsystem,
            {"llm_calls": 0, "embedding_calls": 0, "total_tokens": 0},
        )
        user_total = totals["by_user"].setdefault(
            user_id,
            {"llm_calls": 0, "embedding_calls": 0, "total_tokens": 0},
        )

        try:
            llm_calls = int(llm.get("calls", 0) or 0)
            embedding_calls = int(embedding.get("calls", 0) or 0)
            total_tokens = (
                int(llm.get("total_tokens", 0) or 0)
                + int(embedding.get("total_tokens", 0) or 0)
            )
            subsystem_total["llm_calls"] += llm_calls
            subsystem_total["embedding_calls"] += embedding_calls
            subsystem_total["total_tokens"] += total_tokens
            user_total["llm_calls"] += llm_calls
            user_total["embedding_calls"] += embedding_calls
            user_total["total_tokens"] += total_tokens
        except (TypeError, ValueError):
            continue

    return totals
