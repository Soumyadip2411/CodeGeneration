"""Cosmos DB repository for CodeGen workflows."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from shared_lib.storage import get_container

from .models import Workflow, WorkflowCreate, WorkflowUpdate, WorkflowStatus

logger = logging.getLogger(__name__)

CONTAINER_NAME = "codegen-workflows"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkflowRepository:
    """CRUD operations for codegen workflows in Cosmos DB."""

    def _container(self):
        return get_container(CONTAINER_NAME)

    def create(
        self,
        body: WorkflowCreate,
        *,
        owner_id: str,
        user_id: str,
    ) -> Workflow:
        wf = Workflow(
            owner_id=owner_id,
            name=body.name,
            description=body.description,
            primary_usage=body.primary_usage,
            business_unit=body.business_unit,
            created_by=user_id,
        )
        doc = wf.model_dump(mode="json")
        self._container().upsert_item(doc)
        logger.info(
            "[workflows] created id=%s name=%s owner=%s",
            wf.id,
            wf.name.replace("\n", " ").replace("\r", " "),
            owner_id,
        )
        return wf

    def get(self, workflow_id: str, owner_id: str) -> Optional[Workflow]:
        try:
            doc = self._container().read_item(
                item=workflow_id,
                partition_key=owner_id,
            )
            return Workflow.model_validate(doc)
        except Exception as ex:
            if "NotFound" in str(ex) or "404" in str(ex):
                return None
            raise

    def get_any_owner(self, workflow_id: str) -> Optional[Workflow]:
        """Cross-partition lookup by id for routes that don't have owner_id."""
        query = "SELECT * FROM c WHERE c.id = @id"
        params = [{"name": "@id", "value": workflow_id}]
        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            )
        )
        if not items:
            return None
        return Workflow.model_validate(items[0])

    def list(
        self,
        owner_id: str,
        *,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> List[Workflow]:
        if status:
            query = (
                "SELECT * FROM c WHERE c.owner_id = @oid "
                "AND c.status = @st ORDER BY c.created_at DESC "
                "OFFSET 0 LIMIT @lim"
            )
            params = [
                {"name": "@oid", "value": owner_id},
                {"name": "@st", "value": status},
                {"name": "@lim", "value": limit},
            ]
        else:
            query = (
                "SELECT * FROM c WHERE c.owner_id = @oid "
                "ORDER BY c.created_at DESC OFFSET 0 LIMIT @lim"
            )
            params = [
                {"name": "@oid", "value": owner_id},
                {"name": "@lim", "value": limit},
            ]

        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                partition_key=owner_id,
            )
        )
        return [Workflow.model_validate(doc) for doc in items]

    def list_all(self, *, limit: int = 200) -> List[Workflow]:
        """Cross-partition list - used for dashboard/admin views."""
        query = (
            "SELECT * FROM c ORDER BY c.created_at DESC "
            "OFFSET 0 LIMIT @lim"
        )
        params = [{"name": "@lim", "value": limit}]
        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            )
        )
        return [Workflow.model_validate(doc) for doc in items]

    def update(
        self,
        workflow_id: str,
        owner_id: str,
        body: WorkflowUpdate,
    ) -> Optional[Workflow]:
        wf = self.get(workflow_id, owner_id)
        if wf is None:
            return None

        updates = body.model_dump(exclude_none=True)
        for key, value in updates.items():
            setattr(wf, key, value)

        wf.updated_at = _now_iso()
        self._container().upsert_item(wf.model_dump(mode="json"))
        return wf

    def upsert(self, wf: Workflow) -> None:
        """Raw upsert - used by pipeline to update status/run counts."""
        wf.updated_at = _now_iso()
        self._container().upsert_item(wf.model_dump(mode="json"))

    def delete(self, workflow_id: str, owner_id: str) -> bool:
        try:
            self._container().delete_item(
                item=workflow_id,
                partition_key=owner_id,
            )
            return True
        except Exception:
            return False

    def dashboard_summary(self, owner_id: str) -> Dict[str, int]:
        """Aggregate counts by status for dashboard stat cards."""
        workflows = self.list(owner_id, limit=500)
        summary = {
            "total": 0,
            "running": 0,
            "completed": 0,
            "pending_input": 0,
        }

        for wf in workflows:
            summary["total"] += 1

            if wf.status == WorkflowStatus.GENERATING.value:
                summary["running"] += 1
            elif wf.status == WorkflowStatus.COMPLETED.value:
                summary["completed"] += 1
            elif wf.status in (
                WorkflowStatus.WAITING_FOR_ANSWERS.value,
                WorkflowStatus.QUESTIONS_GENERATED.value,
            ):
                summary["pending_input"] += 1

        return summary


# Singleton
_repo: Optional[WorkflowRepository] = None


def get_workflow_repository() -> WorkflowRepository:
    global _repo
    if _repo is None:
        _repo = WorkflowRepository()
    return _repo
