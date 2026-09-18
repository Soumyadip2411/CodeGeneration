"""Run models for the CodeGen backend."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


class CodegenRun(BaseModel):
    """A single code generation run within a workflow."""

    id: str = Field(default_factory=_new_id)
    workflow_id: str
    owner_id: str = ""
    status: str = RunStatus.QUEUED.value
    stage: str = ""
    progress: int = 0
    triggered_by: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None

    # Input snapshot
    input_file_ids: List[str] = Field(default_factory=list)

    # Output
    artifact_blob_root: Optional[str] = None
    artifact_manifest_path: Optional[str] = None
    artifact_file_count: int = 0
    artifact_total_bytes: int = 0

    # Token usage
    token_usage: Optional[Dict[str, Any]] = None

    # Agent trace (durable events persisted on completion)
    agent_trace: List[Dict[str, Any]] = Field(default_factory=list)

    # Timestamps
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class RunCreate(BaseModel):
    """Request body for POST /api/codegen/workflows/{id}/runs."""

    note: Optional[str] = None
    stage: Optional[str] = None
