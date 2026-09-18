"""Azure Blob Storage helper for the CodeGen backend.

All codegen artifacts live under a single container (default: ``codegen-artifacts``)
at the path layout:

    {workflow_id}/inputs/{file_id}/{filename}       <- user uploads
    {workflow_id}/{run_id}/artifact-manifest.json   <- generated code
    {workflow_id}/exports/{run_id}/generated-code.zip

Thread-safe singleton pattern (same as analyzer blob.py).
"""

from __future__ import annotations

import logging
from threading import Lock
from typing import List, Optional, Tuple

from config import settings

logger = logging.getLogger(__name__)

_lock = Lock()
_service = None
_container_client = None


def is_blob_enabled() -> bool:
    return settings.blob_configured


def _ensure_clients():
    global _service, _container_client

    if _container_client is not None:
        return _service, _container_client

    with _lock:
        if _container_client is not None:
            return _service, _container_client

        from azure.storage.blob import BlobServiceClient

        _service = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
        _container_client = _service.get_container_client(
            settings.artifacts_container
        )

        try:
            _container_client.create_container()
            logger.info(
                "[blob] created container '%s'",
                settings.artifacts_container,
            )
        except Exception:
            # Container already exists - expected in normal operation.
            pass

    return _service, _container_client


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def input_blob_path(workflow_id: str, file_id: str, filename: str) -> str:
    """Path for a user-uploaded input file."""
    return f"{workflow_id}/inputs/{file_id}/{filename}"


def artifact_blob_root(workflow_id: str, run_id: str) -> str:
    """Root prefix for a run's generated artifacts."""
    return f"{workflow_id}/{run_id}"


# ---------------------------------------------------------------------------
# Upload / Download / List / Delete
# ---------------------------------------------------------------------------

def upload_blob(
    blob_path: str,
    data: bytes,
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes to the given blob path. Returns the blob URL."""
    from azure.storage.blob import ContentSettings

    _, container = _ensure_clients()
    blob_client = container.get_blob_client(blob_path)

    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )

    logger.info(
        "[blob] uploaded path=%s size=%d",
        blob_path.replace("\n", " ").replace("\r", " "),
        len(data),
    )
    return blob_client.url


def download_blob(blob_path: str) -> Optional[bytes]:
    """Download blob contents. Returns None if not found."""
    _, container = _ensure_clients()
    blob_client = container.get_blob_client(blob_path)

    try:
        stream = blob_client.download_blob()
        return stream.readall()
    except Exception as ex:
        if "BlobNotFound" in str(ex) or "404" in str(ex):
            return None
        raise


def delete_blob(blob_path: str) -> bool:
    """Delete a single blob. Returns True if deleted, False if not found."""
    _, container = _ensure_clients()
    blob_client = container.get_blob_client(blob_path)

    try:
        blob_client.delete_blob()
        return True
    except Exception:
        return False


def list_blobs(prefix: str) -> List[str]:
    """List all blob names under a prefix."""
    _, container = _ensure_clients()
    return [
        b.name
        for b in container.list_blobs(name_starts_with=prefix)
    ]


def delete_blobs_by_prefix(prefix: str) -> int:
    """Delete all blobs under a prefix. Returns count deleted."""
    paths = list_blobs(prefix)
    _, container = _ensure_clients()

    count = 0
    for path in paths:
        try:
            container.get_blob_client(path).delete_blob()
            count += 1
        except Exception as exc:
            logger.debug(
                "[blob] failed to delete path=%s: %s",
                path,
                exc,
            )

    logger.info(
        "[blob] deleted %d blobs under prefix=%s",
        count,
        prefix,
    )
    return count


def get_blob_url(blob_path: str) -> str:
    """Get the full URL for a blob (no SAS - internal use only)."""
    _, container = _ensure_clients()
    return container.get_blob_client(blob_path).url
