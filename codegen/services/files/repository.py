"""Cosmos DB repository for Codegen workflow files."""

from __future__ import annotations

import logging
from typing import List, Optional

from shared_lib.storage import get_container

from .models import WorkflowFile


logger = logging.getLogger(__name__)

CONTAINER_NAME = "codegen-files"


class FileRepository:
    """CRUD for file metadata in Cosmos. Actual file bytes live in Blob."""

    def _container(self):
        return get_container(CONTAINER_NAME)

    def create(self, file: WorkflowFile) -> WorkflowFile:
        self._container().upsert_item(file.model_dump(mode="json"))
        logger.info(
            "[files] created id=%s workflow=%s name=%s",
            file.id,
            file.workflow_id,
            file.filename,
        )
        return file

    def get(self, file_id: str, workflow_id: str) -> Optional[WorkflowFile]:
        try:
            doc = self._container().read_item(
                item=file_id,
                partition_key=workflow_id,
            )
            return WorkflowFile.model_validate(doc)
        except Exception as ex:
            if "NotFound" in str(ex) or "404" in str(ex):
                return None
            raise

    def list(self, workflow_id: str) -> List[WorkflowFile]:
        query = (
            "SELECT * FROM c WHERE c.workflow_id = @wid "
            "ORDER BY c.uploaded_at DESC"
        )
        params = [{"name": "@wid", "value": workflow_id}]
        items = list(
            self._container().query_items(
                query=query,
                parameters=params,
                partition_key=workflow_id,
            )
        )
        return [WorkflowFile.model_validate(doc) for doc in items]

    def delete(self, file_id: str, workflow_id: str) -> bool:
        try:
            self._container().delete_item(
                item=file_id,
                partition_key=workflow_id,
            )
            return True
        except Exception:
            return False

    def count(self, workflow_id: str) -> int:
        query = "SELECT VALUE COUNT(1) FROM c WHERE c.workflow_id = @wid"
        params = [{"name": "@wid", "value": workflow_id}]
        results = list(
            self._container().query_items(
                query=query,
                parameters=params,
                partition_key=workflow_id,
            )
        )
        return results[0] if results else 0


_repo: Optional[FileRepository] = None


def get_file_repository() -> FileRepository:
    global _repo
    if _repo is None:
        _repo = FileRepository()
    return _repo
