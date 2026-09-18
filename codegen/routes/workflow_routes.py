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

    return {
        "ok": True,
        "questions": [q.model_dump(mode="json") for q in wf.review_questions],
        "gap_score": wf.current_gap_score,
        "gap_threshold": wf.gap_threshold_score,
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

