"""Workflow CRUD + dashboard endpoints."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import JSONResponse

from shared_lib.auth import current_user_id
from shared_lib.storage import is_cosmos_enabled

from services.workflows import (
    WorkflowCreate,
    WorkflowUpdate,
    get_workflow_repository,
)


logger = logging.getLogger(__name__)
router = APIRouter()


def _require_cosmos():
    if not is_cosmos_enabled():
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error": {
                    "code": "COSMOS_DISABLED",
                    "message": "Cosmos DB not configured.",
                },
            },
        )
    return None


def _not_found(msg: str = "Workflow not found."):
    return JSONResponse(
        status_code=404,
        content={
            "ok": False,
            "error": {"code": "NOT_FOUND", "message": msg},
        },
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/api/codegen/dashboard/summary")
async def dashboard_summary(
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    summary = get_workflow_repository().dashboard_summary(user_id)
    return summary


# ---------------------------------------------------------------------------
# Workflow CRUD
# ---------------------------------------------------------------------------

@router.post("/api/codegen/workflows", status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    wf = get_workflow_repository().create(
        body,
        owner_id=user_id,
        user_id=user_id,
    )
    return {
        "ok": True,
        "workflow": wf.model_dump(mode="json"),
    }


@router.get("/api/codegen/workflows")
async def list_workflows(
    status: Optional[str] = Query(default=None),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    workflows = get_workflow_repository().list(
        user_id,
        status=status,
    )
    return {
        "ok": True,
        "workflows": [
            w.model_dump(mode="json") for w in workflows
        ],
    }


@router.get("/api/codegen/workflows/{workflow_id}")
async def get_workflow(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    wf = get_workflow_repository().get(
        workflow_id,
        user_id,
    )

    if wf is None:
        # Try cross-partition (all users can see all workflows)
        wf = get_workflow_repository().get_any_owner(workflow_id)

    if wf is None:
        return _not_found()

    return {
        "ok": True,
        "workflow": wf.model_dump(mode="json"),
    }


@router.patch("/api/codegen/workflows/{workflow_id}")
async def update_workflow(
    body: WorkflowUpdate,
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    wf = get_workflow_repository().update(
        workflow_id,
        user_id,
        body,
    )

    if wf is None:
        return _not_found()

    return {
        "ok": True,
        "workflow": wf.model_dump(mode="json"),
    }


@router.delete("/api/codegen/workflows/{workflow_id}")
async def delete_workflow(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    ok = get_workflow_repository().delete(
        workflow_id,
        user_id,
    )

    if not ok:
        return _not_found()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Gap Analysis & SDD Endpoints
# ---------------------------------------------------------------------------

from pydantic import BaseModel

class AnswerSubmit(BaseModel):
    question_id: str
    answer: str

class AnswersPayload(BaseModel):
    answers: list[AnswerSubmit]

@router.get("/api/codegen/workflows/{workflow_id}/questions")
async def get_questions(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    wf = get_workflow_repository().get_any_owner(workflow_id)
    if not wf:
        return _not_found()

    def _weighted_score(q) -> int:
        if q.priority == "critical":
            return 3
        if q.priority == "suggested":
            return 2
        return 1

    total_weighted = sum(_weighted_score(q) for q in wf.review_questions)
    resolved_weighted = sum(
        _weighted_score(q) for q in wf.review_questions if q.is_resolved
    )
    completion_pct = (
        round((resolved_weighted / total_weighted) * 100)
        if total_weighted > 0
        else 100
    )
    critical_unresolved = [
        q.id for q in wf.review_questions if q.priority == "critical" and not q.is_resolved
    ]

    return {
        "ok": True,
        "questions": [q.model_dump(mode="json") for q in wf.review_questions],
        "gap_score": wf.current_gap_score,
        "gap_threshold": wf.gap_threshold_score,
        "min_analysis_completion": wf.min_analysis_completion,
        "risk_critical_threshold": wf.risk_critical_threshold,
        "completion_pct": completion_pct,
        "all_critical_resolved": len(critical_unresolved) == 0,
        "unresolved_critical_ids": critical_unresolved,
        "can_proceed_to_sdd": (
            len(critical_unresolved) == 0
            and completion_pct >= (wf.min_analysis_completion or 80)
            and wf.current_gap_score <= wf.gap_threshold_score
        ),
    }


@router.post("/api/codegen/workflows/{workflow_id}/questions/answers")
async def submit_answers(
    body: AnswersPayload,
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    repo = get_workflow_repository()
    wf = repo.get_any_owner(workflow_id)
    if not wf:
        return _not_found()

    answer_dict = {a.question_id: a.answer for a in body.answers}
    
    for q in wf.review_questions:
        if q.id in answer_dict:
            q.user_answer = answer_dict[q.id]
            q.is_resolved = True

    wf.current_gap_score = sum(q.weight for q in wf.review_questions if not q.is_resolved)
    repo.upsert(wf)

    return {
        "ok": True,
        "gap_score": wf.current_gap_score,
        "threshold_met": wf.current_gap_score <= wf.gap_threshold_score,
    }


@router.post("/api/codegen/workflows/{workflow_id}/sdd/approve")
async def approve_sdd(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    repo = get_workflow_repository()
    wf = repo.get_any_owner(workflow_id)
    if not wf:
        return _not_found()

    wf.status = "plan_approved"
    repo.upsert(wf)

    return {"ok": True, "status": wf.status}


@router.get("/api/codegen/workflows/{workflow_id}/sdd/preview")
async def get_sdd_preview(
    workflow_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    """Return the SDD markdown preview (inlined on workflow) for the UI.

    Falls back to reading SDD.md from the latest run's artifacts if present and
    the inline preview has not been populated.
    """
    blocked = _require_cosmos()
    if blocked:
        return blocked

    repo = get_workflow_repository()
    wf = repo.get_any_owner(workflow_id)
    if not wf:
        return _not_found()

    markdown = (wf.sdd_preview_markdown or "").strip()
    artifact_read_error = None

    # Fallback: try reading SDD.md from the latest run's output dir if we have no inline markdown
    if not markdown and wf.latest_run_id:
        try:
            from config import settings
            from pathlib import Path

            candidate = (
                Path(settings.workspace_root)
                / wf.id
                / wf.latest_run_id
                / "output"
                / "SDD.md"
            )
            if candidate.exists():
                markdown = candidate.read_text(encoding="utf-8", errors="replace")
        except Exception as ex:
            artifact_read_error = str(ex)

    return {
        "ok": True,
        "markdown": markdown,
        "status": wf.status,
        "approved": wf.status == "plan_approved" or wf.status == "completed",
        "artifact_read_error": artifact_read_error,
    }

