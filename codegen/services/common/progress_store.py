"""Single latest progress frame per run — polled by the SSE /progress endpoint.

Ported from analyzer_backend. Simple dict store, no threading lock needed
(Python dict operations are atomic for single-key set/get).
"""

from __future__ import annotations

from typing import Any, Dict, Optional


_progress_store: Dict[str, Dict[str, Any]] = {}


def set_progress(
    run_id: str,
    step: int,
    message: str,
    *,
    done: bool = False,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    """Update or create progress frame for a run."""
    if not run_id:
        return

    val: Dict[str, Any] = {"step": step, "message": message, "done": done}
    if payload is not None:
        val["payload"] = payload
    else:
        previous = _progress_store.get(run_id, {})
        if "payload" in previous:
            val["payload"] = previous["payload"]

    _progress_store[run_id] = val


def get_progress(run_id: str) -> Dict[str, Any]:
    """Return latest progress frame for a run."""
    return _progress_store.get(
        run_id,
        {"step": 0, "message": "Initiating...", "done": False},
    )


def clear_progress(run_id: str) -> None:
    """Remove progress frame for a run."""
    _progress_store.pop(run_id, None)
