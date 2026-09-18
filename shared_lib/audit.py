"""
Fire-and-forget audit emitter.

Every RAID subsystem calls ``audit_emit(...)`` on state-changing operations.
The event is written directly to Cosmos container ``audit_events`` (PK
``/tenant_id``) so the Admin UI can read the union without each subsystem
having to call back into Admin.

When Cosmos is not configured (e.g. local dev with no COSMOS_* env vars),
emission is a no-op with a single warning per process so tests stay quiet.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .logging_utils import scrub_log


logger = logging.getLogger(__name__)

AUDIT_CONTAINER_NAME = "audit_events"
AUDIT_CONTAINER_PARTITION_KEY = "/tenant_id"
DEFAULT_TENANT_ID = "default"

_lock = threading.Lock()
_container: Any = None
_warned: bool = False


def _cosmos_endpoint() -> Optional[str]:
    return os.getenv("COSMOS_ENDPOINT")


def _cosmos_key() -> Optional[str]:
    return os.getenv("COSMOS_KEY")


def _cosmos_database() -> str:
    return os.getenv("COSMOS_DATABASE", "euca")


def is_audit_enabled() -> bool:
    return bool(_cosmos_endpoint() and _cosmos_key())


def _get_container() -> Any:
    """Return a cached azure-cosmos container proxy, creating the container
    lazily on first use. Returns ``None`` when Cosmos is not configured.
    """
    global _container, _warned

    if _container is not None:
        return _container

    if not is_audit_enabled():
        if not _warned:
            logger.warning(
                "[audit] COSMOS_ENDPOINT/KEY not set - audit events will be no-op'd."
            )
            _warned = True
        return None

    with _lock:
        if _container is not None:
            return _container

        try:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient(
                _cosmos_endpoint(),
                credential=_cosmos_key(),
            )
            db = client.create_database_if_not_exists(id=_cosmos_database())
            _container = db.create_container_if_not_exists(
                id=AUDIT_CONTAINER_NAME,
                partition_key=PartitionKey(path=AUDIT_CONTAINER_PARTITION_KEY),
            )
            logger.info(
                "[audit] container ready name=%s pk=%s",
                AUDIT_CONTAINER_NAME,
                AUDIT_CONTAINER_PARTITION_KEY,
            )
        except Exception:  # noqa: BLE001
            logger.exception("[audit] failed to bootstrap container - disabling")
            _container = None

    return _container


def audit_emit(
    *,
    subsystem: str,
    event_kind: str,
    actor_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    severity: str = "info",
) -> Optional[str]:
    """
    Emit a single audit event. Returns the event id on success, ``None`` when
    audit is disabled or the write failed (logged, never raised).

    Required: ``subsystem`` (admin|analyzer|codegen|enduser) and
    ``event_kind`` (verb_object, e.g. ``project_created``, ``infra_deployed``).
    """
    container = _get_container()
    if container is None:
        return None

    event_id = str(uuid.uuid4())
    tid = (tenant_id or DEFAULT_TENANT_ID).strip() or DEFAULT_TENANT_ID

    doc = {
        "id": event_id,
        "tenant_id": tid,
        "subsystem": subsystem,
        "event_kind": event_kind,
        "actor_id": actor_id,
        "target_type": target_type,
        "target_id": target_id,
        "severity": severity,
        "payload": payload or {},
        "ts": datetime.now(timezone.utc).isoformat(),
    }

    try:
        container.create_item(doc)
        return event_id
    except Exception:  # noqa: BLE001
        logger.exception(
            "[audit] write failed kind=%s tenant=%s",
            scrub_log(event_kind),
            scrub_log(tid),
        )
        return None
