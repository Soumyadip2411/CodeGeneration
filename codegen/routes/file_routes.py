"""File upload/list/delete endpoints for codegen workflows."""
from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, Depends, File, Path, UploadFile
from fastapi.responses import JSONResponse

from shared_lib.auth import current_user_id
from shared_lib.storage import is_cosmos_enabled

from services.files import WorkflowFile, get_file_repository
from services.storage import input_blob_path, is_blob_enabled, upload_blob, delete_blob
from services.workflows import get_workflow_repository


logger = logging.getLogger(__name__)
router = APIRouter()


def _require_storage():
    if not is_cosmos_enabled():
        return JSONResponse(status_code=503, content={
            "ok": False,
            "error": {
                "code": "COSMOS_DISABLED",
                "message": "Cosmos DB not configured."
            }
        })

    if not is_blob_enabled():
        return JSONResponse(status_code=503, content={
            "ok": False,
            "error": {
                "code": "BLOB_DISABLED",
                "message": "Blob Storage not configured."
            }
        })

    return None


@router.post("/api/codegen/workflows/{workflow_id}/files/upload")
async def upload_file(
    workflow_id: str = Path(...),
    file: UploadFile = File(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_storage()
    if blocked:
        return blocked

    # Verify workflow exists
    wf_repo = get_workflow_repository()
    wf = wf_repo.get_any_owner(workflow_id)
    if wf is None:
        return JSONResponse(status_code=404, content={
            "ok": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "Workflow not found."
            }
        })

    # Read file bytes
    data = await file.read()
    file_id = WorkflowFile.__fields__["id"].default_factory()  # generate UUID

    # Compute SHA256
    sha = hashlib.sha256(data).hexdigest()

    # Upload to Blob
    blob_path = input_blob_path(workflow_id, file_id, file.filename)
    upload_blob(
        blob_path,
        data,
        content_type=file.content_type or "application/octet-stream",
    )

    # Save metadata to Cosmos
    wf_file = WorkflowFile(
        id=file_id,
        workflow_id=workflow_id,
        filename=file.filename,
        size_bytes=len(data),
        content_type=file.content_type or "application/octet-stream",
        blob_path=blob_path,
        uploaded_by=user_id,
        sha256=sha,
    )

    file_repo = get_file_repository()
    file_repo.create(wf_file)

    # Update workflow file_count
    wf.file_count = file_repo.count(workflow_id)
    if wf.status == "created":
        wf.status = "files_uploaded"

    wf_repo.upsert(wf)

    return {"ok": True, "file": wf_file.model_dump(mode="json")}


@router.get("/api/codegen/workflows/{workflow_id}/files")
async def list_files(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_storage()
    if blocked:
        return blocked

    files = get_file_repository().list(workflow_id)
    return {
        "ok": True,
        "files": [f.model_dump(mode="json") for f in files],
    }


@router.delete("/api/codegen/workflows/{workflow_id}/files/{file_id}")
async def delete_file(
    workflow_id: str = Path(...),
    file_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_storage()
    if blocked:
        return blocked

    file_repo = get_file_repository()
    wf_file = file_repo.get(file_id, workflow_id)

    if wf_file is None:
        return JSONResponse(status_code=404, content={
            "ok": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "File not found."
            }
        })

    # Delete from Blob
    if wf_file.blob_path:
        delete_blob(wf_file.blob_path)

    # Delete metadata from Cosmos
    file_repo.delete(file_id, workflow_id)

    # Update workflow file_count
    wf_repo = get_workflow_repository()
    wf = wf_repo.get_any_owner(workflow_id)
    if wf:
        wf.file_count = file_repo.count(workflow_id)
        wf_repo.upsert(wf)

    return {"ok": True}
