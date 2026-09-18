"""File models for the CodeGen backend."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class FileSourceType(str, Enum):
    UPLOAD = "upload"
    ANALYZER_REFERENCE = "analyzer_reference"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


class WorkflowFile(BaseModel):
    """Metadata for a file associated with a codegen workflow."""

    id: str = Field(default_factory=_new_id)
    workflow_id: str  # Partition key
    filename: str
    size_bytes: int = 0
    content_type: str = "application/octet-stream"
    source_type: str = FileSourceType.UPLOAD.value

    # For direct uploads — path in codegen-artifacts container:
    blob_path: Optional[str] = None

    # For future analyzer references:
    analyzer_blob_path: Optional[str] = None
    analyzer_container: Optional[str] = None
    analyzer_asset_id: Optional[str] = None

    # Metadata:
    uploaded_at: str = Field(default_factory=_now_iso)
    uploaded_by: str = ""
    sha256: Optional[str] = None
