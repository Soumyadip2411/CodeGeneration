"""In-memory, per-run agent event bus — live transport for the Progress tab.

Ported from analyzer_backend. Append-only, thread-safe, cursor-based.
Not durable — authoritative copy lives on the Run document in Cosmos.
"""

from __future__ import annotations

import contextlib
import contextvars
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional


EVENT_VERSION = 1

_events: OrderedDict[str, List[Dict[str, Any]]] = OrderedDict()
_seq: Dict[str, int] = {}
_lock = threading.Lock()

MAX_EVENTS_PER_RUN = 4000
MAX_RUNS = 64

_ambient_run_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "event_bus_run_id", default=None
)


def _now_ms() -> int:
    """Return the current Unix timestamp in milliseconds."""
    return int(time.time() * 1000)


def publish_event(
    run_id: str, event: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Append one event to a run's live log. Never raises."""
    if not run_id:
        return None

    try:
        with _lock:
            seq = _seq.get(run_id, 0) + 1
            _seq[run_id] = seq

            stored = dict(event)
            stored["v"] = event.get("v", EVENT_VERSION)
            stored["seq"] = seq
            stored["ts"] = stored.get("ts") or _now_ms()
            stored["run_id"] = run_id

            bucket = _events.get(run_id)
            if bucket is None:
                bucket = []
                _events[run_id] = bucket

                while len(_events) > MAX_RUNS:
                    old_id, _ = _events.popitem(last=False)
                    _seq.pop(old_id, None)

            bucket.append(stored)

            if len(bucket) > MAX_EVENTS_PER_RUN:
                del bucket[: len(bucket) - MAX_EVENTS_PER_RUN]

            return stored
    except Exception:
        return None


def publish(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Publish to the ambient run. No-op when unbound."""
    return publish_event(current_run_id() or "", event)


def get_events_since(
    run_id: str, after_seq: int = 0
) -> List[Dict[str, Any]]:
    """Return events with seq > after_seq for a run."""
    if not run_id:
        return []

    with _lock:
        bucket = _events.get(run_id)
        if not bucket:
            return []

        if after_seq <= 0:
            return list(bucket)

        return [e for e in bucket if e.get("seq", 0) > after_seq]


def latest_seq(run_id: str) -> int:
    """Return the latest sequence number for a run."""
    with _lock:
        return _seq.get(run_id, 0)


def clear_events(run_id: str) -> None:
    """Drop a run's live log."""
    if not run_id:
        return

    with _lock:
        _events.pop(run_id, None)
        _seq.pop(run_id, None)


# ---------------------------------------------------------------------------
# Ambient run binding
# ---------------------------------------------------------------------------


def current_run_id() -> Optional[str]:
    """Return the currently bound ambient run ID."""
    return _ambient_run_id.get()


@contextlib.contextmanager
def bind_run(run_id: Optional[str]):
    """Bind a run ID as ambient for the duration of the block."""
    token = _ambient_run_id.set(run_id)
    try:
        yield
    finally:
        _ambient_run_id.reset(token)
