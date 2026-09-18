"""
Spec lifecycle endpoints - Cosmos-backed via ``services/specs``.

When Cosmos is configured (``COSMOS_ENDPOINT`` + ``COSMOS_KEY``), all reads
and writes go through ``SpecRepository`` / ``CapabilityRepository``. When it
is not configured (local dev / first-boot), we fall back to in-memory dicts
so the contract still works for smoke tests and front-end wiring.

The contract on POST /api/specs matches the analyzer's codegen handoff:

{
    "tenant_id": str,
    "euc_id": str,
    "run_id": str,
    "pdd": { ...any JSON... },
    "manifest": {"inputs": [...], "working": [...], "outputs": [...]}
}
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import JSONResponse

from shared_lib.audit import audit_emit
from shared_lib.auth import current_user_id
from shared_lib.storage import is_cosmos_enabled

from services.specs import (
    Capability,
    CapabilityStatus,
    SpecStatus,
    SpecSubmit,
    get_capability_repository,
    get_spec_repository,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# In-memory fallback when Cosmos isn't configured. Lost on restart; that's
# acceptable for local dev because Cosmos is the source of truth in any
# deployed environment.
# ---------------------------------------------------------------------------

MEM_SPECS: Dict[str, Dict[str, Any]] = {}
MEM_CAPABILITIES: Dict[str, Dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _not_found(spec_id: str):
    return JSONResponse(
        status_code=404,
        content={
            "ok": False,
            "error": {
                "code": "NOT_FOUND",
                "message": f"Spec '{spec_id}' not found",
            },
        },
    )


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------

@router.post("/api/specs", status_code=201)
async def submit_spec(
    body: SpecSubmit,
    actor_id: str = Depends(current_user_id),
) -> Dict[str, Any]:
    """Receive an approved PDD handoff from the Analyzer."""
    if is_cosmos_enabled():
        spec = get_spec_repository().create(body, actor_id=actor_id)
        audit_emit(
            "codegen_spec_submitted",
            tenant_id=spec.tenant_id,
            spec_id=spec.id,
            euc_id=spec.euc_id,
            run_id=spec.run_id,
            actor_id=actor_id,
        )
        return {
            "ok": True,
            "spec": {
                "id": spec.id,
                "status": spec.status.value,
            },
        }

    spec_id = str(uuid.uuid4())
    record = {
        "id": spec_id,
        "tenant_id": body.tenant_id,
        "euc_id": body.euc_id,
        "run_id": body.run_id,
        "pdd": body.pdd,
        "manifest": body.manifest or {},
        "status": SpecStatus.QUEUED.value,
        "artifacts": [],
        "created_at": _now(),
        "updated_at": _now(),
        "created_by": actor_id,
        "updated_by": actor_id,
    }
    MEM_SPECS[spec_id] = record
    return {
        "ok": True,
        "spec": {
            "id": spec_id,
            "status": record["status"],
        },
    }


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("/api/specs")
async def list_specs(
    tenant_id: str = Query(..., min_length=1),
    status: Optional[str] = Query(None),
) -> Dict[str, Any]:
    if is_cosmos_enabled():
        status_enum = SpecStatus(status) if status else None
        specs = get_spec_repository().list(tenant_id, status=status_enum)
        return {
            "ok": True,
            "specs": [s.model_dump(mode="json") for s in specs],
        }

    items = list(MEM_SPECS.values())
    items = [s for s in items if s.get("tenant_id") == tenant_id]
    if status:
        items = [s for s in items if s.get("status") == status]

    items.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return {"ok": True, "specs": items}


@router.get("/api/specs/{spec_id}")
async def get_spec(
    spec_id: str = Path(...),
    tenant_id: Optional[str] = Query(None),
):
    if is_cosmos_enabled():
        repo = get_spec_repository()
        spec = (
            repo.get(tenant_id, spec_id)
            if tenant_id
            else repo.get_any_tenant(spec_id)
        )
        if spec is None:
            return _not_found(spec_id)
        return {
            "ok": True,
            "spec": spec.model_dump(mode="json"),
        }

    spec = MEM_SPECS.get(spec_id)
    if not spec:
        return _not_found(spec_id)
    return {"ok": True, "spec": spec}


@router.get("/api/specs/{spec_id}/artifacts")
async def list_artifacts(
    spec_id: str = Path(...),
    tenant_id: Optional[str] = Query(None),
):
    if is_cosmos_enabled():
        repo = get_spec_repository()
        spec = (
            repo.get(tenant_id, spec_id)
            if tenant_id
            else repo.get_any_tenant(spec_id)
        )
        if spec is None:
            return _not_found(spec_id)
        return {
            "ok": True,
            "artifacts": [
                a.model_dump(mode="json") for a in spec.artifacts
            ],
        }

    spec = MEM_SPECS.get(spec_id)
    if not spec:
        return _not_found(spec_id)
    return {
        "ok": True,
        "artifacts": spec.get("artifacts", []),
    }


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

@router.post("/api/specs/{spec_id}/publish")
async def publish_spec(
    spec_id: str = Path(...),
    tenant_id: Optional[str] = Query(None),
    actor_id: str = Depends(current_user_id),
):
    """Mark the spec as published and register a capability.

    Until the real generator lands this is still a mock - but persisted now,
    so the End User catalog survives restart and the front-end Codegen pages
    have something stable to display.
    """
    if is_cosmos_enabled():
        spec_repo = get_spec_repository()
        cap_repo = get_capability_repository()
        spec = (
            spec_repo.get(tenant_id, spec_id)
            if tenant_id
            else spec_repo.get_any_tenant(spec_id)
        )
        if spec is None:
            return _not_found(spec_id)

        cap_id = str(uuid.uuid4())
        pdd = spec.pdd if isinstance(spec.pdd, dict) else {}
        capability = Capability(
            id=cap_id,
            tenant_id=spec.tenant_id,
            spec_id=spec.id,
            name=str(
                pdd.get("name")
                or pdd.get("title")
                or f"capability-{cap_id[:8]}"
            ),
            description=str(
                pdd.get("summary")
                or pdd.get("description")
                or ""
            )
            or None,
            status=CapabilityStatus.AVAILABLE,
            published_by=actor_id,
        )

        cap_repo.create(capability)
        spec_repo.update_status(
            spec.tenant_id,
            spec.id,
            SpecStatus.PUBLISHED,
            capability_id=cap_id,
            actor_id=actor_id,
        )

        audit_emit(
            "codegen_spec_published",
            tenant_id=spec.tenant_id,
            spec_id=spec.id,
            capability_id=cap_id,
            actor_id=actor_id,
        )

        return {
            "ok": True,
            "capability": capability.model_dump(mode="json"),
        }

    spec = MEM_SPECS.get(spec_id)
    if not spec:
        return _not_found(spec_id)

    spec["status"] = SpecStatus.PUBLISHED.value
    spec["updated_at"] = _now()

    cap_id = str(uuid.uuid4())
    pdd = spec.get("pdd") or {}
    pdd_dict = pdd if isinstance(pdd, dict) else {}

    capability = {
        "id": cap_id,
        "tenant_id": spec["tenant_id"],
        "spec_id": spec_id,
        "name": (
            pdd_dict.get("name")
            or pdd_dict.get("title")
            or f"capability-{cap_id[:8]}"
        ),
        "description": pdd_dict.get("summary"),
        "status": CapabilityStatus.AVAILABLE.value,
        "mcp_tool_uri": None,
        "published_at": _now(),
        "published_by": actor_id,
    }

    spec["capability_id"] = cap_id
    MEM_CAPABILITIES[cap_id] = capability

    return {"ok": True, "capability": capability}


# ---------------------------------------------------------------------------
# Capabilities catalog
# ---------------------------------------------------------------------------

@router.get("/api/capabilities")
async def list_capabilities(
    tenant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
) -> Dict[str, Any]:
    if is_cosmos_enabled():
        status_enum = CapabilityStatus(status) if status else None
        caps = get_capability_repository().list(
            tenant_id,
            status=status_enum,
        )
        return {
            "ok": True,
            "capabilities": [
                c.model_dump(mode="json") for c in caps
            ],
        }

    items = list(MEM_CAPABILITIES.values())

    if tenant_id:
        items = [
            c for c in items
            if c.get("tenant_id") == tenant_id
        ]

    if status:
        items = [
            c for c in items
            if c.get("status") == status
        ]

    items.sort(
        key=lambda c: c.get("published_at", ""),
        reverse=True,
    )

    return {"ok": True, "capabilities": items}
