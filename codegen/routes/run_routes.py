"""Run endpoints - start, status, progress SSE, events SSE, cancel."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from shared_lib.auth import current_user_id
from shared_lib.storage import is_cosmos_enabled

from services.common.event_bus import get_events_since
from services.common.progress_store import get_progress, set_progress
from services.files import get_file_repository
from services.runs import RunCreate, RunStatus, get_run_repository, start_run
from services.runs.pipeline import request_cancel
from services.workflows import get_workflow_repository


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


def _not_found(msg: str = "Not found."):
    return JSONResponse(
        status_code=404,
        content={
            "ok": False,
            "error": {"code": "NOT_FOUND", "message": msg},
        },
    )


# ---------------------------------------------------------------------------
# Create run
# ---------------------------------------------------------------------------

@router.post(
    "/api/codegen/workflows/{workflow_id}/runs",
    status_code=202,
)
async def create_run(
    body: RunCreate,
    workflow_id: str = Path(...),
    sync: bool = Query(default=False),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    wf = get_workflow_repository().get_any_owner(workflow_id)
    if wf is None:
        return _not_found("Workflow not found.")

    # Gather input file ids
    files = get_file_repository().list(workflow_id)
    input_file_ids = [f.id for f in files]

    run, err = start_run(
        workflow_id=workflow_id,
        owner_id=wf.owner_id,
        user_id=user_id,
        input_file_ids=input_file_ids,
        sync=sync,
    )

    if run is None:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": {
                    "code": "RUN_START_FAILED",
                    "message": err or "Could not start run",
                },
            },
        )

    # Update workflow status
    wf.status = "generating"
    wf.latest_run_id = run.id
    wf.latest_run_status = run.status
    get_workflow_repository().upsert(wf)

    return JSONResponse(
        status_code=202,
        content={
            "ok": True,
            "run": run.model_dump(mode="json"),
        },
    )


# ---------------------------------------------------------------------------
# List runs for a workflow
# ---------------------------------------------------------------------------

@router.get("/api/codegen/workflows/{workflow_id}/runs")
async def list_runs(
    workflow_id: str = Path(...),
    limit: int = Query(default=20, ge=1, le=100),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    runs = get_run_repository().list_for_workflow(workflow_id, limit=limit)
    return {
        "ok": True,
        "runs": [r.model_dump(mode="json") for r in runs],
    }


# ---------------------------------------------------------------------------
# Get run status
# ---------------------------------------------------------------------------

@router.get("/api/codegen/runs/{run_id}/status")
async def get_run_status(
    run_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    run = get_run_repository().get_any(run_id)
    if run is None:
        return _not_found("Run not found.")

    return {
        "ok": True,
        "run": run.model_dump(mode="json"),
    }


# ---------------------------------------------------------------------------
# Cancel run
# ---------------------------------------------------------------------------

@router.post("/api/codegen/runs/{run_id}/cancel")
async def cancel_run_endpoint(
    run_id: str = Path(...),
    user_id: str = Depends(current_user_id),
):
    blocked = _require_cosmos()
    if blocked:
        return blocked

    run = get_run_repository().get_any(run_id)
    if run is None:
        return _not_found("Run not found.")

    # Only the user who triggered the run can cancel it
    if run.triggered_by and run.triggered_by != user_id:
        return JSONResponse(
            status_code=403,
            content={
                "ok": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "Only the user who started this run can cancel it.",
                },
            },
        )

    terminal = {
        RunStatus.COMPLETED.value,
        RunStatus.FAILED.value,
        RunStatus.CANCELLED.value,
    }
    if run.status in terminal:
        return {
            "ok": True,
            "run": run.model_dump(mode="json"),
        }

    request_cancel(run_id)
    get_run_repository().mark_cancelled(run, "Cancelled by user")
    set_progress(
        run_id,
        100,
        "Cancelled by user",
        done=True,
        payload={"run_status": "cancelled"},
    )

    # Update the workflow document so the UI status badge + footer update immediately
    from services.workflows import get_workflow_repository

    wf_repo = get_workflow_repository()
    wf = wf_repo.get_any_owner(run.workflow_id)
    if wf:
        wf.status = "cancelled"
        wf.latest_run_status = "cancelled"
        wf_repo.upsert(wf)

    return {
        "ok": True,
        "run": run.model_dump(mode="json"),
    }


# ---------------------------------------------------------------------------
# SSE - progress (single linear frame, polled every 500ms)
# ---------------------------------------------------------------------------

@router.get("/api/codegen/runs/{run_id}/progress")
async def stream_run_progress(run_id: str, request: Request):
    """Server-Sent Events stream of run progress."""

    async def event_generator():
        last_step = -1
        last_message = ""
        last_done = False

        while True:
            if await request.is_disconnected():
                break

            data = get_progress(run_id)
            step = data.get("step", 0)
            msg = data.get("message", "")
            done = bool(data.get("done"))

            if step != last_step or msg != last_message or done != last_done:
                yield f"data: {json.dumps(data)}\n\n"
                last_step = step
                last_message = msg
                last_done = done

            if done:
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# SSE - rich events (cursor-based, polled every 250ms)
# ---------------------------------------------------------------------------

@router.get("/api/codegen/runs/{run_id}/events")
async def stream_run_events(
    run_id: str,
    request: Request,
    after: int = Query(default=0, ge=0),
):
    """Server-Sent Events stream of per-agent events."""

    async def event_generator():
        cursor = after
        idle_ticks = 0

        while True:
            if await request.is_disconnected():
                break

            batch = get_events_since(run_id, cursor)

            if batch:
                for ev in batch:
                    cursor = ev.get("seq", cursor)
                    yield f"data: {json.dumps(ev, default=str)}\n\n"
                idle_ticks = 0
            else:
                idle_ticks += 1

            if get_progress(run_id).get("done"):
                for ev in get_events_since(run_id, cursor):
                    cursor = ev.get("seq", cursor)
                    yield f"data: {json.dumps(ev, default=str)}\n\n"
                yield (
                    f"event: done\ndata: "
                    f"{json.dumps({'done': True, 'seq': cursor})}\n\n"
                )
                break

            if idle_ticks and idle_ticks % 20 == 0:
                yield ": ping\n\n"

            await asyncio.sleep(0.25)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
