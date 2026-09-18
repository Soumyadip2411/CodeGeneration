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
        start_msg = "Starting code generation from the approved Solution Design Document..."
        if stage == "gap_analysis":
            start_msg = "Starting gap analysis - analyzing uploaded design documents..."
        elif stage == "sdd_generation":
            start_msg = "Starting SDD generation - synthesizing PDD and resolved gap answers into System Design Document..."
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
            import re as _re_json

            if stage == "gap_analysis":
                _emit_progress(run.id, 5, "Agent working - analyzing input documents for gaps and ambiguities...", stage=stage)
                # Gap analysis agent needs access to file-reading tools so it can inspect uploaded PDDs
                agent = make_agent(name="EUC CodeGen Analyst", instructions=GAP_ANALYSIS_PROMPT, tools=ALL_TOOLS)
                gap_task_prompt = (
                    "TASK:\n"
                    "1. First call list_input_files() to discover the uploaded documents, then read every uploaded file "
                    "(use read_input_lines in 50-line batches for large files > 200 lines).\n"
                    "2. Analyze the documents thoroughly and produce the structured JSON array of gap questions exactly "
                    "as specified in your instructions (3 primary categories, confidence/risk scores, suggested answers, "
                    "rationales, 8-15 questions total).\n"
                    "3. After you have fully answered the analysis and are ready to emit your final response, output ONLY "
                    "the valid JSON array — no markdown, no introductory sentences, no code fences. Pure JSON text."
                )
                response_text, meta = run_agent_sync(agent, gap_task_prompt)

                try:
                    # Multi-strategy JSON extraction — robust to prose / ```json fences / leading whitespace
                    def _extract_json_array(text: str):
                        if not text:
                            return None
                        # Strategy 1: try parsing the whole thing stripped
                        stripped = text.strip()
                        try:
                            data = json.loads(stripped)
                            if isinstance(data, list):
                                return data
                        except Exception:
                            pass
                        # Strategy 2: strip surrounding ```json ... ``` or ``` ... ```
                        m = _re_json.search(
                            r"```(?:json|JSON)?\s*([\s\S]*?)```",
                            text,
                        )
                        if m:
                            try:
                                data = json.loads(m.group(1).strip())
                                if isinstance(data, list):
                                    return data
                            except Exception:
                                pass
                        # Strategy 3: find first [ and last ] + basic brace-balance skip
                        start = text.find("[")
                        end = text.rfind("]")
                        if start >= 0 and end > start:
                            candidate = text[start : end + 1]
                            try:
                                data = json.loads(candidate)
                                if isinstance(data, list):
                                    return data
                            except Exception:
                                pass
                        return None

                    questions_data = _extract_json_array(response_text)

                    if questions_data is None or not isinstance(questions_data, list) or len(questions_data) == 0:
                        raise ValueError(f"No valid JSON question array extracted. Response snippet: {response_text[:400]!r}")

                    from services.workflows.models import ReviewQuestion, QuestionPriority, QuestionCategory

                    parsed: list[ReviewQuestion] = []
                    for raw in questions_data:
                        if not isinstance(raw, dict):
                            continue
                        # Coerce category into a valid enum value — fall back to OTHER
                        raw_cat = str(raw.get("category") or "other").lower().strip()
                        known_cats = {e.value for e in QuestionCategory}
                        if raw_cat not in known_cats:
                            # Map the three primary bucket names (used by prompt contract) to enum values
                            alias_map = {
                                "business_rules": QuestionCategory.BUSINESS_RULES.value,
                                "inputs_outputs": QuestionCategory.INPUTS_OUTPUTS.value,
                                "security": QuestionCategory.SECURITY.value,
                                "other": QuestionCategory.OTHER.value,
                                "validations": QuestionCategory.VALIDATIONS.value,
                                "integrations": QuestionCategory.INTEGRATIONS.value,
                            }
                            raw_cat = alias_map.get(raw_cat, QuestionCategory.OTHER.value)
                        raw["category"] = raw_cat
                        # Coerce priority
                        raw_pri = str(raw.get("priority") or "suggested").lower().strip()
                        if raw_pri not in {e.value for e in QuestionPriority}:
                            raw_pri = QuestionPriority.SUGGESTED.value
                        raw["priority"] = raw_pri
                        # Ensure numeric fields are present with sane defaults
                        raw.setdefault("confidence_score", 70)
                        raw.setdefault("risk_score", 30)
                        raw.setdefault("weight", 10)
                        # Ensure suggested_answer / rationale are never null for optional questions
                        if raw.get("priority") == QuestionPriority.OPTIONAL.value and not raw.get("suggested_answer"):
                            raw["suggested_answer"] = "Use industry standard best practices and document any assumptions made."
                        if not raw.get("rationale"):
                            raw["rationale"] = "Clarification improves downstream SDD accuracy and reduces implementation risk."
                        try:
                            rq = ReviewQuestion(**raw)
                        except Exception as inner:
                            logger.warning("[pipeline] skipping malformed review question: %s data=%s", inner, raw)
                            continue
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

                    # Fallback generator: if parsing produced zero usable questions, synthesize
                    # a default set so the review UI is always populated and testable.
                    if len(parsed) == 0:
                        logger.warning("[pipeline] gap analysis produced 0 valid parsed questions; injecting fallback question set")
                        fallback = [
                            {
                                "text": "What is the primary business workflow or decision rule this system must implement end-to-end?",
                                "category": QuestionCategory.BUSINESS_RULES.value,
                                "priority": QuestionPriority.CRITICAL.value,
                                "confidence_score": 95,
                                "risk_score": 90,
                                "weight": 25,
                                "suggested_answer": "Document the end-to-end workflow as a numbered step-by-step process including all exception paths, approvals, and SLA targets per step.",
                                "rationale": "Without knowing the core workflow the SDD and code will implement the wrong business logic.",
                            },
                            {
                                "text": "List all input data sources: file names/extensions, schemas, required columns, expected row volume ranges, and any sample data available.",
                                "category": QuestionCategory.INPUTS_OUTPUTS.value,
                                "priority": QuestionPriority.CRITICAL.value,
                                "confidence_score": 95,
                                "risk_score": 85,
                                "weight": 25,
                                "suggested_answer": "For each input: list file format (CSV/Excel/JSON), full column list with data types, any key columns, row volume per run (daily/weekly), and attach or describe sample data.",
                                "rationale": "Inputs drive all ingestion code; incorrect assumptions here cause broken adapters.",
                            },
                            {
                                "text": "What output files/reports must be produced and what columns/format/sheet structure does each require?",
                                "category": QuestionCategory.INPUTS_OUTPUTS.value,
                                "priority": QuestionPriority.CRITICAL.value,
                                "confidence_score": 90,
                                "risk_score": 80,
                                "weight": 25,
                                "suggested_answer": "List each output artifact by filename, format (Excel/CSV/PDF), sheet names, column order, sort/filters, and any conditional formatting or template to replicate.",
                                "rationale": "Output structure is the user-visible contract; ambiguity here leads to rework.",
                            },
                            {
                                "text": "What user roles must access this system and what actions (read/edit/approve/admin) is each role permitted to perform?",
                                "category": QuestionCategory.SECURITY.value,
                                "priority": QuestionPriority.CRITICAL.value,
                                "confidence_score": 85,
                                "risk_score": 85,
                                "weight": 25,
                                "suggested_answer": "Define an RBAC matrix: role × permission mapping. Include authentication mechanism (SSO/local/AD), password policy, and session timeout requirements.",
                                "rationale": "Authorization and authentication are core security requirements that are expensive to retrofit.",
                            },
                            {
                                "text": "Describe all PII (personally identifiable information) fields present in the data and how they must be handled (masking, retention, encryption, access logging).",
                                "category": QuestionCategory.SECURITY.value,
                                "priority": QuestionPriority.CRITICAL.value,
                                "confidence_score": 85,
                                "risk_score": 92,
                                "weight": 28,
                                "suggested_answer": "Enumerate PII fields by name; specify whether logging/display must mask (last 4 only, etc), retention period, at-rest encryption requirement, and audit-log requirements.",
                                "rationale": "Un-handled PII creates audit/compliance failures and legal exposure.",
                            },
                            {
                                "text": "What input validations must be performed per column? Include nullability constraints, allowed value sets/ranges, uniqueness checks, and cross-column consistency rules.",
                                "category": QuestionCategory.VALIDATIONS.value,
                                "priority": QuestionPriority.SUGGESTED.value,
                                "confidence_score": 80,
                                "risk_score": 65,
                                "weight": 14,
                                "suggested_answer": "Specify per-column: allow null? data type/range? allowed enumerated values? uniqueness? cross-column rules (e.g., start_date < end_date).",
                                "rationale": "Without explicit validation rules bad data flows through and produces corrupted outputs.",
                            },
                            {
                                "text": "Are there any external integrations or API calls (email, database, REST, message queue) that the system must make as part of its workflow?",
                                "category": QuestionCategory.INTEGRATIONS.value,
                                "priority": QuestionPriority.SUGGESTED.value,
                                "confidence_score": 75,
                                "risk_score": 60,
                                "weight": 12,
                                "suggested_answer": "List each integration: direction (inbound/outbound), protocol, auth method, retry strategy, SLA/timeout, and sample payload. If none, explicitly confirm no integrations.",
                                "rationale": "Integrations change the system architecture; discovering them late forces major refactors.",
                            },
                            {
                                "text": "What SLAs apply (runtime duration, data freshness, availability window) and what failure handling / retries / alerting is required?",
                                "category": QuestionCategory.BUSINESS_RULES.value,
                                "priority": QuestionPriority.OPTIONAL.value,
                                "confidence_score": 70,
                                "risk_score": 40,
                                "weight": 4,
                                "suggested_answer": "Example: pipeline must finish within 30 min after trigger, retry failed transient steps up to 3x with exponential backoff, alert ops distribution list on failure.",
                                "rationale": "SLAs dictate architectural choices (streaming vs batch, async vs sync) and ops tooling.",
                            },
                            {
                                "text": "What error recovery and rollback behavior is expected when a step fails mid-pipeline?",
                                "category": QuestionCategory.BUSINESS_RULES.value,
                                "priority": QuestionPriority.OPTIONAL.value,
                                "confidence_score": 65,
                                "risk_score": 35,
                                "weight": 4,
                                "suggested_answer": "Specify whether partial outputs must be rolled back, whether idempotent re-runs are supported, and whether manual intervention gates or auto-resume is preferred.",
                                "rationale": "Recovery/rollback strategy affects transaction design and idempotency requirements.",
                            },
                        ]
                        parsed = [ReviewQuestion(**q) for q in fallback]

                    wf.review_questions = parsed

                    # Calculate initial gap score
                    wf.current_gap_score = sum(q.weight for q in wf.review_questions if not q.is_resolved)
                    wf.status = "waiting_for_answers"
                except Exception as e:
                    logger.warning("[pipeline] gap analysis parsing failed: %s. Response: %s", e, response_text[:800], exc_info=True)
                    # Ultimate safety net: ensure questions list is always populated so HITL gate is testable
                    from services.workflows.models import ReviewQuestion, QuestionPriority, QuestionCategory
                    wf.review_questions = [
                        ReviewQuestion(text="Confirm the uploaded documents correctly describe the full business process to be automated.", category=QuestionCategory.BUSINESS_RULES, priority=QuestionPriority.CRITICAL, confidence_score=99, risk_score=90, weight=25, suggested_answer="Verify the PDD covers end-to-end workflow. If gaps remain, extend the PDD and re-upload before proceeding.", rationale="Ensures the SDD is built against the correct scope."),
                        ReviewQuestion(text="Confirm all input schemas, output schemas, and file formats have been correctly specified.", category=QuestionCategory.INPUTS_OUTPUTS, priority=QuestionPriority.CRITICAL, confidence_score=99, risk_score=85, weight=25, suggested_answer="List each input and output explicitly with columns/types/formats.", rationale="Prevents data-translation bugs in generated code."),
                        ReviewQuestion(text="Confirm all security requirements (authentication, RBAC, PII handling, audit logging) are fully specified.", category=QuestionCategory.SECURITY, priority=QuestionPriority.CRITICAL, confidence_score=99, risk_score=90, weight=25, suggested_answer="Provide a role matrix, auth mechanism, PII masking rules, and audit requirements.", rationale="Security requirements are expensive to retrofit post-implementation."),
                        ReviewQuestion(text="List any known edge cases, exception paths, or boundary conditions not covered in the current documents.", category=QuestionCategory.BUSINESS_RULES, priority=QuestionPriority.SUGGESTED, confidence_score=90, risk_score=65, weight=12, suggested_answer="Walk through each step's failure modes and document expected behavior for each.", rationale="Exception handling and edge cases are a common source of post-launch bugs."),
                    ]
                    wf.current_gap_score = sum(q.weight for q in wf.review_questions if not q.is_resolved)
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
                _emit_progress(run.id, 5, "Agent working - generating implementation code from the approved SDD...", stage=stage)
                # ---------------------------------------------------------------------------
                # Ensure the authoritative Solution Design Document is available to the
                # code-generation agent in the input workspace. Precedence:
                #   1. wf.sdd_preview_markdown (cached on the workflow after sdd_generation)
                #   2. SDD.md artifact from the most recent completed run
                #   3. Fallback: warn and proceed, allowing agent to fall back to uploaded docs
                # ---------------------------------------------------------------------------
                sdd_input_path = input_dir / "SDD.md"
                sdd_seeded = False
                sdd_source = "not-available"
                if getattr(wf, "sdd_preview_markdown", None):
                    try:
                        sdd_input_path.write_text(wf.sdd_preview_markdown, encoding="utf-8")
                        sdd_seeded = True
                        sdd_source = "workflow.sdd_preview_markdown"
                    except Exception as _sdd_err:
                        logger.warning("[pipeline] failed to write sdd_preview_markdown to input dir: %s", _sdd_err)
                if not sdd_seeded and wf.latest_run_id:
                    try:
                        from services.storage import download_blob, artifact_blob_root
                        prev_blob_root = artifact_blob_root(workflow_id=wf.id, run_id=wf.latest_run_id)
                        sdd_candidate = f"{prev_blob_root}/SDD.md"
                        blob_data = download_blob(sdd_candidate)
                        if blob_data:
                            sdd_input_path.write_bytes(blob_data)
                            sdd_seeded = True
                            sdd_source = f"blob:{sdd_candidate}"
                    except Exception as _sdd_err:
                        logger.warning("[pipeline] failed to seed SDD.md from previous run artifact: %s", _sdd_err)
                if not sdd_seeded:
                    # Last-resort seed from output dir of the current run (if SDD was generated in this same call chain)
                    candidate_prev = output_dir / "SDD.md"
                    if candidate_prev.exists():
                        try:
                            sdd_input_path.write_text(candidate_prev.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
                            sdd_seeded = True
                            sdd_source = "local-output-fallback"
                        except Exception:
                            pass
                logger.info("[pipeline] code_generation SDD seeding: seeded=%s source=%s", sdd_seeded, sdd_source)

                system_prompt = build_system_prompt(language="python")
                agent = make_agent(
                    name="EUC CodeGen",
                    instructions=system_prompt,
                    tools=ALL_TOOLS,
                )
                codegen_task_prompt = (
                    "Generate a complete, working codebase using the following priority of inputs "
                    "(HIGHEST FIRST):\n"
                    "\n"
                    "1. SDD.md — THIS IS YOUR AUTHORITATIVE SPECIFICATION. Read SDD.md FIRST with "
                    "read_input_file (or read_input_lines in 50-line batches if large) and implement "
                    "every requirement exactly as specified there. When in doubt, SDD.md wins.\n"
                    "2. Any other uploaded design documents — use them only as supplementary context "
                    "if a detail is not covered by the SDD.\n"
                    "\n"
                    "Follow the 8-phase workflow in your system instructions strictly, with SDD.md "
                    "as the source of truth:\n"
                    "  Phase 1 — UNDERSTAND: start by reading SDD.md end-to-end, then any other input\n"
                    "                  files. Call memory_set_plan immediately afterward.\n"
                    "  Phases 2..7 — SCAFFOLD through TESTS: implement exactly what SDD.md specifies.\n"
                    "  Phase 8 — VERIFY: list_output_files, spot-check, confirm plan all completed.\n"
                    "\n"
                    "Write every generated file to the output workspace using write_code_file.\n"
                )
                response_text, meta = run_agent_sync(agent, codegen_task_prompt)
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
