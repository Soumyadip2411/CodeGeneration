"""Workflow Pydantic models for the CodeGen backend."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class WorkflowStatus(str, Enum):
    CREATED = "created"
    FILES_UPLOADED = "files_uploaded"
    SUMMARY_GENERATED = "summary_generated"
    QUESTIONS_GENERATED = "questions_generated"
    WAITING_FOR_ANSWERS = "waiting_for_answers"
    PLAN_GENERATED = "plan_generated"
    PLAN_APPROVED = "plan_approved"
    GENERATING = "generating"
    UPLOADING_ARTIFACTS = "uploading_artifacts"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SourceType(str, Enum):
    UPLOAD = "upload"
    ANALYZER = "analyzer"


class WorkflowSource(BaseModel):
    """Tracks where input files come from.

    MVP: upload only. Future: analyzer_project_id + run_id
    for cross-reference.
    """

    type: SourceType = SourceType.UPLOAD
    analyzer_project_id: Optional[str] = None
    analyzer_run_id: Optional[str] = None
    analyzer_pdd_version: Optional[int] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


class Workflow(BaseModel):
    """CodeGen workflow - the top-level entity that owns files, runs, plans."""

    id: str = Field(default_factory=_new_id)
    owner_id: str
    name: str
    description: str = ""
    primary_usage: str = ""
    business_unit: str = ""
    status: str = WorkflowStatus.CREATED.value
    source: WorkflowSource = Field(default_factory=WorkflowSource)
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    created_by: str = ""
    file_count: int = 0
    run_count: int = 0
    latest_run_id: Optional[str] = None
    latest_run_status: Optional[str] = None


class WorkflowCreate(BaseModel):
    """Request body for POST /api/codegen/workflows."""

    name: str
    description: str = ""
    primary_usage: str = ""
    business_unit: str = ""


class WorkflowUpdate(BaseModel):
    """Request body for PATCH /api/codegen/workflows/{id}."""

    name: Optional[str] = None
    description: Optional[str] = None
    primary_usage: Optional[str] = None
    business_unit: Optional[str] = None
    status: Optional[str] = None
