"""CodeGen agent tools — enterprise pattern with @tool decorator.

Tools operate on a local workspace that is created per-run:
  /workspace/codegen/{workflow_id}/{run_id}/input/   <- downloaded from Blob
  /workspace/codegen/{workflow_id}/{run_id}/output/  <- agent writes here

After execution, pipeline.py uploads output/ to Blob and deletes the workspace.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Annotated

from pydantic import Field
from agent_framework import tool

from services.common import event_bus

logger = logging.getLogger(__name__)

# These get set by the pipeline before agent execution for the current run.
_workspace_input: Path = Path(".")
_workspace_output: Path = Path(".")


def configure_workspace(input_dir: Path, output_dir: Path) -> None:
    """Called by pipeline to set workspace paths for the current run."""
    global _workspace_input, _workspace_output
    _workspace_input = input_dir
    _workspace_output = output_dir


def _emit_tool(tool_name: str, detail: str) -> None:
    """Emit a tool event to the event bus for live UI streaming."""
    rid = event_bus.current_run_id()
    if rid:
        event_bus.publish_event(
            rid,
            {
                "type": "agent.tool.end",
                "agent": "EUC_CodeGen",
                "level": "info",
                "message": f"{tool_name}: {detail}",
                "data": {"tool": tool_name, "detail": detail},
            },
        )


# ---------------------------------------------------------------------------
# 1. INPUT READING
# ---------------------------------------------------------------------------

@tool
def read_input_file(
    file_name: Annotated[str, Field(description="Name of a file in the input folder")],
) -> str:
    """Read the full content of an uploaded input file (SDD, design document, spec, etc.).

    For code generation, SDD.md is the authoritative specification when present.
    For large files (>200 lines), prefer count_input_lines + read_input_lines in batches.
    """
    path = _workspace_input / file_name
    if not path.exists():
        available = (
            [f.name for f in _workspace_input.iterdir()]
            if _workspace_input.exists()
            else []
        )
        return f"ERROR: '{file_name}' not found. Available: {available}"
    text = path.read_text(encoding="utf-8", errors="replace")
    _emit_tool("read_input_file", f"{file_name} ({len(text)} chars)")
    return text


@tool
def count_input_lines(
    file_name: Annotated[str, Field(description="Name of a file in the input folder")],
) -> str:
    """Return the total number of lines in an input file.

    Use this BEFORE read_input_lines to plan how many batches you need.
    """
    path = _workspace_input / file_name
    if not path.exists():
        return f"ERROR: '{file_name}' not found."
    total = len(path.read_text(encoding="utf-8", errors="replace").splitlines())
    _emit_tool("count_input_lines", f"{file_name}: {total} lines")
    return f"{file_name}: {total} lines"


@tool
def read_input_lines(
    file_name: Annotated[str, Field(description="Name of a file in the input folder")],
    start_line: Annotated[int, Field(description="First line to read (1-based)")] = 1,
    end_line: Annotated[int, Field(description="Last line to read (1-based, inclusive)")] = 50,
) -> str:
    """Read a specific range of lines from an input file.

    Use with count_input_lines for large files in manageable batches of ~50 lines.
    This avoids overwhelming context for large spec documents.
    """
    path = _workspace_input / file_name
    if not path.exists():
        return f"ERROR: '{file_name}' not found."

    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    total = len(lines)
    s = max(0, start_line - 1)
    e = min(end_line, total)
    batch = lines[s:e]

    numbered = "\n".join(f"{s + i + 1:4} | {line}" for i, line in enumerate(batch))
    _emit_tool("read_input_lines", f"{file_name} lines {s + 1}-{e} of {total}")
    return f"[{file_name} — lines {s + 1}-{e} of {total}]\n{numbered}"


@tool
def list_input_files() -> str:
    """List all available input files in the workspace."""
    if not _workspace_input.exists():
        return "Input folder is empty."

    files = sorted(_workspace_input.iterdir())
    items = [
        f"{f.name} ({f.stat().st_size} bytes)"
        for f in files
        if f.is_file()
    ]
    _emit_tool("list_input_files", f"{len(items)} files")
    return "\n".join(items) if items else "No input files found."


# ---------------------------------------------------------------------------
# 2. CODE WRITING (output folder)
# ---------------------------------------------------------------------------

@tool
def write_code_file(
    file_path: Annotated[
        str,
        Field(description="Path inside the output folder, e.g. 'config.py' or 'engine/exposure.py'"),
    ],
    content: Annotated[
        str,
        Field(description="Complete file content to write"),
    ],
) -> str:
    """Write (or overwrite) a code file in the output workspace.

    Parent directories are created automatically. Always write complete, working files.
    """
    full = _workspace_output / file_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    line_count = content.count("\n") + 1
    _emit_tool("write_code_file", f"{file_path} ({line_count} lines)")
    return f"OK — wrote {line_count} lines to {file_path}"


@tool
def read_output_file(
    file_path: Annotated[
        str,
        Field(description="Path inside output/, e.g. 'config.py'"),
    ],
) -> str:
    """Read back a file from the output workspace to verify its contents."""
    full = _workspace_output / file_path
    if not full.exists():
        return f"ERROR: {file_path} does not exist in output."
    text = full.read_text(encoding="utf-8")
    _emit_tool("read_output_file", f"{file_path} ({len(text)} chars)")
    return f"[{file_path} — {text.count(chr(10)) + 1} lines]\n{text}"


@tool
def list_output_files() -> str:
    """List all files in the output workspace (recursive)."""
    if not _workspace_output.exists():
        return "Output folder is empty."

    items = []
    for item in sorted(_workspace_output.rglob("*")):
        if item.is_file():
            rel = item.relative_to(_workspace_output)
            items.append(str(rel))

    _emit_tool("list_output_files", f"{len(items)} files")
    return "\n".join(items) if items else "Output folder is empty."


# ---------------------------------------------------------------------------
# 3. SESSION MEMORY (per-run plan tracker)
# ---------------------------------------------------------------------------

_session: dict = {"todos": []}
_MAX_TODOS = 10
_VALID_STATUSES = {"not_started", "in_progress", "completed"}


def reset_session() -> None:
    """Called by pipeline at run start."""
    global _session
    _session = {"todos": []}


def _format_todos() -> str:
    todos = _session.get("todos", [])
    if not todos:
        return "Plan is empty."

    icons = {"not_started": "□", "in_progress": "◐", "completed": "✅"}
    lines = [
        f"{icons.get(t['status'], '?')} [{t['id']}] {t['description']} — {t['status']}"
        for t in todos
    ]
    done = sum(1 for t in todos if t["status"] == "completed")
    lines.append(f"Progress: {done}/{len(todos)} completed")
    return "\n".join(lines)


@tool
def memory_set_plan(
    todos_json: Annotated[
        str,
        Field(
            description=(
                'JSON array of to-do items. Each: {"id": int, "description": "...", '
                '"status": "not_started"}. Max 10.'
            )
        ),
    ],
) -> str:
    """Set the implementation plan. Call ONCE after reading the spec."""
    global _session

    try:
        items = json.loads(todos_json)
    except json.JSONDecodeError as e:
        return f"ERROR: invalid JSON — {e}"

    if not isinstance(items, list):
        return "ERROR: expected a JSON array."

    clean = []
    for i, item in enumerate(items[:_MAX_TODOS]):
        clean.append(
            {
                "id": item.get("id", i + 1),
                "description": str(item.get("description", ""))[:120],
                "status": item.get("status", "not_started")
                if item.get("status") in _VALID_STATUSES
                else "not_started",
            }
        )

    _session["todos"] = clean
    _emit_tool("memory_set_plan", f"{len(clean)} tasks")
    return f"Plan saved ({len(clean)} tasks).\n{_format_todos()}"


def _get_desc_by_id(tid) -> str:
    """Get existing description for a task ID (fallback for updates without description)."""
    for t in _session.get("todos", []):
        if t.get("id") == tid:
            return t.get("description", "")
    return ""


@tool
def memory_update(
    updates_json: Annotated[
        str,
        Field(
            description=(
                'JSON array of ALL to-do items with their CURRENT status. '
                'Send the FULL list every time — mark just-finished task as "completed" '
                'and next task as "in_progress". Example: '
                '[{"id":1,"status":"completed"},{"id":2,"status":"in_progress"},'
                '{"id":3,"status":"not_started"}]'
            )
        ),
    ],
) -> str:
    """Update the plan by providing the FULL current state of ALL tasks.

    Always send every task — mark the step you just finished as "completed"
    and the next step as "in_progress" in one call.
    You may also change a task's description if the plan evolves.
    Max 10 tasks if needed, never exceed.
    """
    try:
        updates = json.loads(updates_json)
    except json.JSONDecodeError as e:
        return f"ERROR: invalid JSON — {e}"

    if not isinstance(updates, list):
        return "ERROR: expected a JSON array of all to-do items."

    # Accept as full replacement — rebuild the valid list from the supplied updates.
    clean = []
    for i, item in enumerate(updates[:_MAX_TODOS]):
        # Preserve existing description if LLM omits it or sends empty.
        provided_desc = item.get("description") or ""
        fallback_desc = _get_desc_by_id(item.get("id"))
        clean.append(
            {
                "id": item.get("id", i + 1),
                "description": str(provided_desc or fallback_desc)[:120],
                "status": item.get("status", "not_started")
                if item.get("status") in _VALID_STATUSES
                else "not_started",
            }
        )

    _session["todos"] = clean
    _emit_tool("memory_update", f"updated {len(clean)} tasks")
    return f"Plan updated:\n{_format_todos()}"


def _get_desc_by_id(tid) -> str:
    """Get existing description for a task ID (fallback for updates without description)."""
    for t in _session.get("todos", []):
        if t.get("id") == tid:
            return t.get("description", "")
    return ""


@tool
def memory_get_plan() -> str:
    """Get the current plan with all statuses."""
    return _format_todos()


# ---------------------------------------------------------------------------
# TOOL REGISTRY
# ---------------------------------------------------------------------------

ALL_TOOLS = [
    read_input_file,
    count_input_lines,
    read_input_lines,
    list_input_files,
    write_code_file,
    read_output_file,
    list_output_files,
    memory_set_plan,
    memory_update,
    memory_get_plan,
]
