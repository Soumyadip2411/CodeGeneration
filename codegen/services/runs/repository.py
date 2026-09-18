"""Cosmos DB repository for Codegen runs."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from shared_lib.storage import get_container

from .models import CodegenRun, RunStatus

logger = logging.getLogger(__name__)

CONTAINER_NAME = "codegen-runs"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunRepository:
    """CRUD for codegen runs in Cosmos DB."""

    def _container(self):
        return get_container(CONTAINER_NAME)

    def create(self, run: CodegenRun) -> CodegenRun:
        self._container().upsert_item(run.model_dump(mode="json"))
        logger.info(
            "[runs] created id=%s workflow=%s",
            run.id,
            run.workflow_id,
        )
        return run

    def get(self, run_id: str, workflow_id: str) -> Optional[CodegenRun]:
        try:
            doc = self._container().read_item(
                item=run_id,
                partition_key=workflow_id,
            )
            return CodegenRun.model_validate(doc)
        except Exception as ex:
            if "NotFound" in str(ex) or "404" in str(ex):
                return None
            raise

    def get_any(self, run_id: str) -> Optional[CodegenRun]:
        """Cross-partition lookup by id."""
        query = "SELECT * FROM c WHERE c.id = @id"
        params = [{"name": "@id", "value": run_id}]
        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            )
        )
        return CodegenRun.model_validate(items[0]) if items else None

    def list_for_workflow(
        self,
        workflow_id: str,
        *,
        limit: int = 50,
    ) -> List[CodegenRun]:
        query = (
            "SELECT * FROM c WHERE c.workflow_id = @wid "
            "ORDER BY c.created_at DESC OFFSET 0 LIMIT @lim"
        )
        params = [
            {"name": "@wid", "value": workflow_id},
            {"name": "@lim", "value": limit},
        ]
        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                partition_key=workflow_id,
            )
        )
        return [CodegenRun.model_validate(doc) for doc in items]

    def upsert(self, run: CodegenRun) -> None:
        run.updated_at = _now_iso()
        self._container().upsert_item(run.model_dump(mode="json"))

    def mark_running(self, run: CodegenRun) -> None:
        run.status = RunStatus.RUNNING.value
        run.started_at = _now_iso()
        self.upsert(run)

    def mark_completed(self, run: CodegenRun) -> None:
        run.status = RunStatus.COMPLETED.value
        run.completed_at = _now_iso()
        if run.started_at:
            start = datetime.fromisoformat(run.started_at)
            run.duration_ms = int(
                (datetime.now(timezone.utc) - start).total_seconds() * 1000
            )
        self.upsert(run)

    def mark_failed(self, run: CodegenRun, error: str) -> None:
        run.status = RunStatus.FAILED.value
        run.error = error
        run.completed_at = _now_iso()
        if run.started_at:
            start = datetime.fromisoformat(run.started_at)
            run.duration_ms = int(
                (datetime.now(timezone.utc) - start).total_seconds() * 1000
            )
        self.upsert(run)

    def mark_cancelled(self, run: CodegenRun, reason: str) -> None:
        run.status = RunStatus.CANCELLED.value
        run.error = reason
        run.completed_at = _now_iso()
        self.upsert(run)


_repo: Optional[RunRepository] = None


def get_run_repository() -> RunRepository:
    global _repo
    if _repo is None:
        _repo = RunRepository()
    return _repo
