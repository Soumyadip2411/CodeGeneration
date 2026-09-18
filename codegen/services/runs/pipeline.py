"""Run pipeline - threaded execution with cooperative cancellation.

Lifecycle:
    POST /runs -> 202 -> pool.submit(execute_run)
    Worker Thread: setup workspace -> run agent -> upload to blob -> cleanup -> completed

Uses the same patterns as analyzer_backend:
- ThreadPoolExecutor(4) for bounded background work
- Cooperative cancellation via shared set + checkpoint checks
- Event bus binding for real-time UI streaming
"""

from __future__ import annotations

import logging
import os
import shutil
import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Optional, Tuple

from config import settings
from services.common import event_bus
from services.common.progress_store import set_progress
from services.runs.models import CodegenRun
from services.runs.repository import get_run_repository
from services.storage import (
    artifact_blob_root,
    download_blob,
    upload_blob,
)
from services.workflows import get_workflow_repository
from services.files import get_file_repository

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Worker pool - single-process, bounded.
# ---------------------------------------------------------------------------

_pool_lock = Lock()
_pool: Optional[ThreadPoolExecutor] = None


def _get_pool() -> ThreadPoolExecutor:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            _pool = ThreadPoolExecutor(
                max_workers=4,
                thread_name_prefix="codegen-worker",
            )
    return _pool


# ---------------------------------------------------------------------------
# Cooperative cancellation.
# ---------------------------------------------------------------------------

_cancel_lock = Lock()
_cancel_requested: set[str] = set()


class RunCancelled(Exception):
    """Raised inside the worker when a run has been asked to stop."""


def request_cancel(run_id: str) -> None:
    if not run_id:
        return
    with _cancel_lock:
        _cancel_requested.add(run_id)


def is_cancel_requested(run_id: str) -> bool:
    with _cancel_lock:
        return run_id in _cancel_requested


def clear_cancel(run_id: str) -> None:
    with _cancel_lock:
        _cancel_requested.discard(run_id)


def _check_cancel(run_id: str) -> None:
    """Raise RunCancelled if a stop has been requested."""
    if is_cancel_requested(run_id):
        raise RunCancelled()


# ---------------------------------------------------------------------------
# Progress helper
# ---------------------------------------------------------------------------

def _emit_progress(
    run_id: str,
    step: int,
    message: str,
    *,
    done: bool = False,
    status: Optional[str] = None,
    stage: Optional[str] = None,
) -> None:
    payload = {}
    if status is not None:
        payload["run_status"] = status
    if stage is not None:
        payload["stage"] = stage

    set_progress(run_id, step, message, done=done, payload=payload if payload else None)

    if status is not None or stage is not None:
        event_bus.publish_event(
            run_id,
            {
                "type": "run.status",
                "agent": "orchestrator",
                "level": "info",
                "message": message,
                "data": {"status": status, "stage": stage, "done": done, "step": step},
            },
        )


# ---------------------------------------------------------------------------
# Execute run (stub - replaced with agent execution in Phase 3)
# ---------------------------------------------------------------------------

def execute_run(run: CodegenRun) -> CodegenRun:
    """Main run execution - called on a worker thread.

    Phases:
    A. Setup workspace + download input files from Blob
    B. Run MAF agent (reads input, writes code to output/)
    C. Upload output to Blob
    D. Cleanup local workspace
    """
    runs = get_run_repository()
    wf_repo = get_workflow_repository()
    file_repo = get_file_repository()
    
    wf = wf_repo.get_any_owner(run.workflow_id)
    if not wf:
        runs.mark_failed(run, "Workflow not found")
        return run

    # Default to code_generation if stage is empty for backwards compatibility
    stage = run.stage or "code_generation"


    with event_bus.bind_run(run.id):
        runs.mark_running(run)
        start_msg = "Starting code generation..."
        if stage == "gap_analysis":
            start_msg = "Starting gap analysis - scanning PDD for questions..."
        elif stage == "sdd_generation":
            start_msg = "Starting SDD generation with resolved Q&A context..."
        _emit_progress(run.id, 1, start_msg, status="running", stage=stage)

        # Workspace paths
        ws_root = Path(settings.workspace_root) / run.workflow_id / run.id
        input_dir = ws_root / "input"
        output_dir = ws_root / "output"

        try:
            # --- Phase A: Setup workspace -------------------------------
            _check_cancel(run.id)
            _emit_progress(run.id, 2, "Preparing workspace...")
            input_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)

            # Download input files from Blob
            files = file_repo.list(run.workflow_id)
            for f in files:
                if f.blob_path:
                    data = download_blob(f.blob_path)
                    if data:
                        (input_dir / f.filename).write_bytes(data)
                        logger.info(
                            "[pipeline] downloaded %s (%d bytes)",
                            f.filename,
                            len(data),
                        )

            _emit_progress(run.id, 3, f"Downloaded {len(files)} input file(s)")

            # --- Phase B: Run agent ------------------------------------
            _check_cancel(run.id)
            _emit_progress(run.id, 4, "Running code generation agent...")

            from services.agent import (
                make_agent,
                run_agent_sync,
                is_llm_ready,
                configure_workspace,
                reset_session,
                build_system_prompt,
                TASK_PROMPT,
                GAP_ANALYSIS_PROMPT,
                SDD_GENERATION_PROMPT,
                ALL_TOOLS,
            )

            if not is_llm_ready():
                raise RuntimeError(
                    "Azure OpenAI not configured (AZURE_OPENAI_ENDPOINT/KEY missing)"
                )

            # Configure tools to use this run's workspace
            configure_workspace(input_dir, output_dir)
            reset_session()

            import json
            
            if stage == "gap_analysis":
                _emit_progress(run.id, 5, "Agent working - analyzing gaps...", stage=stage)
                agent = make_agent(name="EUC CodeGen Analyst", instructions=GAP_ANALYSIS_PROMPT, tools=[])
                response_text, meta = run_agent_sync(agent, "Analyze the PDD for gaps.")

                try:
                    # Very basic JSON extraction
                    start = response_text.find('[')
                    end = response_text.rfind(']') + 1
                    if start >= 0 and end > start:
                        questions_data = json.loads(response_text[start:end])
                        from services.workflows.models import ReviewQuestion, QuestionPriority

                        parsed: list[ReviewQuestion] = []
                        for q in questions_data:
                            rq = ReviewQuestion(**q)
                            # Enforce risk threshold classification: risk >= critical threshold => critical
                            if rq.risk_score and rq.risk_score >= (wf.risk_critical_threshold or 70):
                                rq.priority = QuestionPriority.CRITICAL
                            # Ensure a weight proportional to priority if weight looks off
                            if not rq.weight or rq.weight <= 0:
                                if rq.priority == QuestionPriority.CRITICAL:
                                    rq.weight = 25
                                elif rq.priority == QuestionPriority.SUGGESTED:
                                    rq.weight = 12
                                else:
                                    rq.weight = 3
                            parsed.append(rq)

                        wf.review_questions = parsed

                        # Calculate initial gap score
                        wf.current_gap_score = sum(q.weight for q in wf.review_questions if not q.is_resolved)
                        wf.status = "waiting_for_answers"
                    else:
                        raise ValueError("No JSON array found in output.")
                except Exception as e:
                    logger.warning("[pipeline] gap analysis parsing failed: %s. Response: %s", e, response_text)
                    wf.review_questions = []
                    wf.status = "waiting_for_answers"

            elif stage == "sdd_generation":
                _emit_progress(run.id, 5, "Agent working - generating SDD...", stage=stage)
                agent = make_agent(name="EUC CodeGen Architect", instructions=SDD_GENERATION_PROMPT, tools=ALL_TOOLS)
                q_context = json.dumps([q.model_dump(mode="json") for q in wf.review_questions])
                prompt = f"Here is the resolved Q&A context:\n{q_context}\n\nGenerate the SDD."
                response_text, meta = run_agent_sync(agent, prompt)

                # Extract SDD markdown preview from the agent response.
                # Try, in order: labelled SDD_PREVIEW_MARKDOWN code block, first ```markdown block, raw response head
                sdd_preview_markdown: str | None = None
                try:
                    import re as _re
                    m = _re.search(
                        r"```(?:SDD_PREVIEW_MARKDOWN|markdown|md)?\s*\n(.*?)```",
                        response_text,
                        _re.DOTALL | _re.IGNORECASE,
                    )
                    if m:
                        sdd_preview_markdown = m.group(1).strip()
                    else:
                        # Fallback: if the response wrote SDD.md and we can load it
                        pass
                except Exception:
                    sdd_preview_markdown = None

                # Fallback: try reading SDD.md back from the output workspace (it was just written)
                if not sdd_preview_markdown:
                    try:
                        candidate = (output_dir / "SDD.md")
                        if candidate.exists():
                            sdd_preview_markdown = candidate.read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        sdd_preview_markdown = None

                # Final fallback: store a truncated snippet of the raw response so preview is never empty
                if not sdd_preview_markdown:
                    sdd_preview_markdown = (
                        "# SDD (Preview)\n\n"
                        "> The architect response could not be parsed into markdown. "
                        "Please use the 'Download SDD' or view the generated SDD.md in the Code View "
                        "tab after code generation to inspect the full document.\n\n"
                        f"```\n{response_text[:4000]}\n```\n"
                    )

                wf.sdd_preview_markdown = sdd_preview_markdown  # type: ignore[attr-defined]
                wf.status = "plan_generated"
                
            else:
                _emit_progress(run.id, 5, "Agent working - generating code...", stage=stage)
                system_prompt = build_system_prompt(language="python")
                agent = make_agent(
                    name="EUC CodeGen",
                    instructions=system_prompt,
                    tools=ALL_TOOLS,
                )
                response_text, meta = run_agent_sync(agent, TASK_PROMPT)
                wf.status = "completed"

            run.agent_trace.append(
                {"response_preview": response_text[:500], "meta": meta}
            )

            # Check cancel immediately after agent returns (agent call is
            # long-blocking, so a cancel request may have arrived during it).
            _check_cancel(run.id)

            stage_complete_msg = "Agent completed code generation"
            if stage == "gap_analysis":
                stage_complete_msg = "Gap analysis complete - review questions ready"
            elif stage == "sdd_generation":
                stage_complete_msg = "SDD generation complete - ready for review"
            _emit_progress(run.id, 7, stage_complete_msg, stage=stage)

            # --- Phase C: Upload to Blob --------------------------------
            _check_cancel(run.id)
            _emit_progress(run.id, 8, "Uploading generated code to storage...")

            blob_root = artifact_blob_root(run.workflow_id, run.id)
            file_count = 0
            total_bytes = 0

            for file_path in sorted(output_dir.rglob("*")):
                if file_path.is_file():
                    _check_cancel(run.id)  # Stop upload if cancelled mid-transfer
                    rel_path = file_path.relative_to(output_dir)
                    blob_path = f"{blob_root}/{rel_path.as_posix()}"
                    data = file_path.read_bytes()
                    upload_blob(blob_path, data)
                    file_count += 1
                    total_bytes += len(data)

            run.artifact_blob_root = blob_root
            run.artifact_file_count = file_count
            run.artifact_total_bytes = total_bytes

            _emit_progress(
                run.id,
                9,
                f"Uploaded {file_count} files ({total_bytes // 1024} KB)",
            )

            # --- Phase D: Cleanup + complete ----------------------------
            # Persist live events to agent_trace so they survive server restart
            live_events = event_bus.get_events_since(run.id, 0)
            run.agent_trace = live_events if live_events else run.agent_trace

            _cleanup_workspace(ws_root)

            runs.mark_completed(run)
            complete_msg = "Completed"
            if stage == "gap_analysis":
                complete_msg = "Gap Analysis Completed - Review Required"
            elif stage == "sdd_generation":
                complete_msg = "SDD Generated - Ready for Approval"
            _emit_progress(
                run.id,
                10,
                complete_msg,
                done=True,
                status="completed",
                stage=stage,
            )

            # Update workflow
            if wf:
                # status is already updated above based on stage
                wf.latest_run_id = run.id
                wf.latest_run_status = "completed"
                wf.run_count += 1
                wf_repo.upsert(wf)

            logger.info(
                "[pipeline] completed run=%s files=%d bytes=%d",
                run.id,
                file_count,
                total_bytes,
            )
            return run

        except RunCancelled:
            logger.info("[pipeline] cancelled run=%s", run.id)
            # The cancel API endpoint may have already marked the run -
            # only update if still running to avoid overwriting.
            fresh = runs.get_any(run.id)
            if fresh and fresh.status not in ("cancelled", "failed", "completed"):
                runs.mark_cancelled(run, "Cancelled by user")

            _emit_progress(
                run.id,
                100,
                "Cancelled by user",
                done=True,
                status="cancelled",
            )

            # Update workflow (cancel endpoint may have done this already,
            # but ensure it's set if the pipeline caught the cancel first).
            wf = wf_repo.get_any_owner(run.workflow_id)
            if wf and wf.status not in ("completed", "failed", "cancelled"):
                wf.status = "cancelled"
                wf.latest_run_status = "cancelled"
                wf_repo.upsert(wf)

            _cleanup_workspace(ws_root)
            return run

        except Exception as ex:
            logger.exception("[pipeline] failed run=%s", run.id)
            runs.mark_failed(run, str(ex))
            _emit_progress(
                run.id,
                99,
                f"Failed: {ex}",
                done=True,
                status="failed",
            )

            wf = wf_repo.get_any_owner(run.workflow_id)
            if wf:
                wf.status = "failed"
                wf.latest_run_id = run.id
                wf.latest_run_status = "failed"
                wf_repo.upsert(wf)

            _cleanup_workspace(ws_root)
            return run

        finally:
            clear_cancel(run.id)


def _cleanup_workspace(ws_root: Path) -> None:
    """Best-effort workspace cleanup.

    Uses an onerror handler to force-remove read-only files on Windows
    (common when an agent writes files that inherit restrictive ACLs).
    Only removes the run-level directory ({workflow_id}/{run_id}/),
    never the parent workflow directory - safe for concurrent runs.
    """

    def _on_rm_error(func, path, _exc_info):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass  # truly stuck - logged below

    try:
        if ws_root.exists():
            shutil.rmtree(ws_root, onerror=_on_rm_error)
            logger.info("[pipeline] cleaned workspace %s", ws_root)
    except Exception as exc:
        logger.warning(
            "[pipeline] workspace cleanup failed for %s: %s",
            ws_root,
            exc,
        )


# ---------------------------------------------------------------------------
# Public entry points (called by routes)
# ---------------------------------------------------------------------------

def start_run(
    *,
    workflow_id: str,
    owner_id: str,
    user_id: str,
    input_file_ids: list,
    sync: bool = False,
    stage: Optional[str] = None,
) -> Tuple[Optional[CodegenRun], Optional[str]]:
    """Create a run and submit it to the thread pool. Returns (run, error)."""
    run = CodegenRun(
        workflow_id=workflow_id,
        owner_id=owner_id,
        triggered_by=user_id,
        input_file_ids=input_file_ids,
        stage=stage or "",
    )

    runs = get_run_repository()
    runs.create(run)
    _emit_progress(run.id, 0, "Queued", status="queued")

    if sync:
        execute_run(run)
        return run, None

    _get_pool().submit(execute_run, run)
    return run, None


def cancel_run(run_id: str) -> None:
    """Signal a running run to stop at the next checkpoint."""
    request_cancel(run_id)
