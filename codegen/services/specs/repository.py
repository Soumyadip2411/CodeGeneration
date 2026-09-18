"""Spec + Capability repositories - Cosmos-backed.

Mirrors the admin tenant/users/bulk pattern: thin facade per container,
process-scoped singleton via `get_*_repository()`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from shared.lib.storage import get_container, is_cosmos_enabled

from .models import (
    Artifact,
    Capability,
    CapabilityStatus,
    Spec,
    SpecStatus,
    SpecSubmit,
)

logger = logging.getLogger(__name__)

SPECS_CONTAINER = "specs"
CAPABILITIES_CONTAINER = "capabilities"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

class SpecRepository:
    def __init__(self) -> None:
        if not is_cosmos_enabled():
            raise RuntimeError("Cosmos is not configured")

    def create(
        self,
        payload: SpecSubmit,
        actor_id: Optional[str] = None,
    ) -> Spec:
        spec_id = str(uuid.uuid4())
        now = _now()

        spec = Spec(
            id=spec_id,
            tenant_id=payload.tenant_id,
            euc_id=payload.euc_id,
            run_id=payload.run_id,
            pdd=payload.pdd,
            manifest=payload.manifest or {},
            status=SpecStatus.QUEUED,
            created_at=now,
            updated_at=now,
            created_by=actor_id,
            updated_by=actor_id,
        )

        container = get_container(SPECS_CONTAINER)
        container.create_item(spec.model_dump(mode="json"))
        return spec

    def get(self, tenant_id: str, spec_id: str) -> Optional[Spec]:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        container = get_container(SPECS_CONTAINER)
        try:
            doc = container.read_item(
                item=spec_id,
                partition_key=tenant_id,
            )
        except CosmosResourceNotFoundError:
            return None

        return Spec(**doc)

    def get_any_tenant(self, spec_id: str) -> Optional[Spec]:
        """Fallback lookup when the caller hasn't supplied a tenant_id."""
        container = get_container(SPECS_CONTAINER)
        items = list(
            container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": spec_id}],
                enable_cross_partition_query=True,
            )
        )
        if not items:
            return None
        return Spec(**items[0])

    def list(
        self,
        tenant_id: str,
        *,
        status: Optional[SpecStatus] = None,
    ) -> List[Spec]:
        container = get_container(SPECS_CONTAINER)

        sql = "SELECT * FROM c WHERE c.tenant_id = @t"
        params = [{"name": "@t", "value": tenant_id}]

        if status is not None:
            sql += " AND c.status = @s"
            params.append({"name": "@s", "value": status.value})

        sql += " ORDER BY c.created_at DESC"

        items = list(
            container.query_items(
                query=sql,
                parameters=params,
                partition_key=tenant_id,
            )
        )
        return [Spec(**item) for item in items]

    def update_status(
        self,
        tenant_id: str,
        spec_id: str,
        status: SpecStatus,
        *,
        error: Optional[str] = None,
        capability_id: Optional[str] = None,
        actor_id: Optional[str] = None,
    ) -> Optional[Spec]:
        spec = self.get(tenant_id, spec_id)
        if spec is None:
            return None

        merged = spec.model_dump()
        merged["status"] = status.value
        merged["updated_at"] = _now()
        merged["updated_by"] = actor_id

        if error is not None:
            merged["error"] = error
        if capability_id is not None:
            merged["capability_id"] = capability_id

        updated = Spec(**merged)
        get_container(SPECS_CONTAINER).upsert_item(
            updated.model_dump(mode="json")
        )
        return updated

    def append_artifact(
        self,
        tenant_id: str,
        spec_id: str,
        artifact: Artifact,
        *,
        actor_id: Optional[str] = None,
    ) -> Optional[Spec]:
        spec = self.get(tenant_id, spec_id)
        if spec is None:
            return None

        artifacts = list(spec.artifacts) + [artifact]
        merged = spec.model_dump()
        merged["artifacts"] = [
            a.model_dump() if isinstance(a, Artifact) else a
            for a in artifacts
        ]
        merged["updated_at"] = _now()
        merged["updated_by"] = actor_id

        updated = Spec(**merged)
        get_container(SPECS_CONTAINER).upsert_item(
            updated.model_dump(mode="json")
        )
        return updated


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------

class CapabilityRepository:
    def __init__(self) -> None:
        if not is_cosmos_enabled():
            raise RuntimeError("Cosmos is not configured")

    def create(self, capability: Capability) -> Capability:
        get_container(CAPABILITIES_CONTAINER).create_item(
            capability.model_dump(mode="json")
        )
        return capability

    def get(
        self,
        tenant_id: str,
        capability_id: str,
    ) -> Optional[Capability]:
        from azure.cosmos.exceptions import CosmosResourceNotFoundError

        container = get_container(CAPABILITIES_CONTAINER)
        try:
            doc = container.read_item(
                item=capability_id,
                partition_key=tenant_id,
            )
        except CosmosResourceNotFoundError:
            return None

        return Capability(**doc)

    def get_any_tenant(
        self,
        capability_id: str,
    ) -> Optional[Capability]:
        container = get_container(CAPABILITIES_CONTAINER)
        items = list(
            container.query_items(
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[
                    {"name": "@id", "value": capability_id}
                ],
                enable_cross_partition_query=True,
            )
        )
        if not items:
            return None
        return Capability(**items[0])

    def list(
        self,
        tenant_id: Optional[str] = None,
        *,
        status: Optional[CapabilityStatus] = None,
    ) -> List[Capability]:
        container = get_container(CAPABILITIES_CONTAINER)

        if tenant_id:
            sql = "SELECT * FROM c WHERE c.tenant_id = @t"
            params = [{"name": "@t", "value": tenant_id}]

            if status is not None:
                sql += " AND c.status = @s"
                params.append({"name": "@s", "value": status.value})

            sql += " ORDER BY c.published_at DESC"

            items = list(
                container.query_items(
                    query=sql,
                    parameters=params,
                    partition_key=tenant_id,
                )
            )
        else:
            sql = "SELECT * FROM c"
            params = []

            if status is not None:
                sql += " WHERE c.status = @s"
                params.append({"name": "@s", "value": status.value})

            sql += " ORDER BY c.published_at DESC"

            items = list(
                container.query_items(
                    query=sql,
                    parameters=params,
                    enable_cross_partition_query=True,
                )
            )

        return [Capability(**item) for item in items]

    def set_status(
        self,
        tenant_id: str,
        capability_id: str,
        status: CapabilityStatus,
    ) -> Optional[Capability]:
        cap = self.get(tenant_id, capability_id)
        if cap is None:
            return None

        merged = cap.model_dump()
        merged["status"] = status.value

        updated = Capability(**merged)
        get_container(CAPABILITIES_CONTAINER).upsert_item(
            updated.model_dump(mode="json")
        )
        return updated


_spec_repo: Optional[SpecRepository] = None
_capability_repo: Optional[CapabilityRepository] = None


def get_spec_repository() -> SpecRepository:
    global _spec_repo
    if _spec_repo is None:
        _spec_repo = SpecRepository()
    return _spec_repo


def get_capability_repository() -> CapabilityRepository:
    global _capability_repo
    if _capability_repo is None:
        _capability_repo = CapabilityRepository()
    return _capability_repo
