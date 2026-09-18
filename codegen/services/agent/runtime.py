"""Agent runtime — constructs and runs MAF Agent objects.

Mirrors analyzer_backend/services/ai/runtime.py pattern:
- Persistent background event loop (avoids ContextVar issues)
- run_agent_sync() dispatches async agent.run() from worker threads
- Emits lifecycle events to event_bus
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from concurrent.futures import Future
from typing import Any, Coroutine, Dict, List, Optional, Sequence, Tuple

from agent_framework import Agent, tool  # noqa: F401 (re-export tool decorator)
from agent_framework.openai import OpenAIChatCompletionClient

from config import settings
from services.common import event_bus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLM Client (singleton)
# ---------------------------------------------------------------------------

_client_lock = threading.Lock()
_client: Optional[OpenAIChatCompletionClient] = None


def _get_client() -> OpenAIChatCompletionClient:
    """Return the singleton Azure OpenAI chat completion client."""
    global _client
    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client
        _client = OpenAIChatCompletionClient(
            model=settings.azure_openai_deployment,
            azure_endpoint=settings.azure_openai_endpoint,
            api_version=settings.azure_openai_api_version,
            api_key=settings.azure_openai_key,
        )
        logger.info(
            "[agent.runtime] client ready model=%s",
            settings.azure_openai_deployment,
        )
        return _client


def is_llm_ready() -> bool:
    """Return whether the LLM is configured."""
    return settings.llm_configured


# ---------------------------------------------------------------------------
# Persistent background event loop (same pattern as analyzer)
# ---------------------------------------------------------------------------

_loop: Optional[asyncio.AbstractEventLoop] = None
_loop_thread: Optional[threading.Thread] = None
_loop_lock = threading.Lock()


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """Return a persistent background event loop."""
    global _loop, _loop_thread

    if _loop is not None and _loop.is_running():
        return _loop

    with _loop_lock:
        if _loop is not None and _loop.is_running():
            return _loop

        _loop = asyncio.new_event_loop()

        def _runner() -> None:
            asyncio.set_event_loop(_loop)
            _loop.run_forever()

        thread = threading.Thread(
            target=_runner,
            name="codegen-agent-loop",
            daemon=True,
        )
        thread.start()
        _loop_thread = thread
        return _loop


def _run_coro(coro: Coroutine[Any, Any, Any]) -> Any:
    """Run a coroutine on the persistent background loop."""
    loop = _ensure_loop()
    fut: Future[Any] = asyncio.run_coroutine_threadsafe(coro, loop)
    return fut.result()


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------

def make_agent(
    *,
    name: str,
    instructions: str,
    tools: Sequence[Any],
) -> Agent:
    """Build an Agent bound to the Azure OpenAI client."""
    client = _get_client()
    return Agent(
        client=client,
        name=name,
        instructions=instructions,
        tools=list(tools),
    )


# ---------------------------------------------------------------------------
# Sync wrapper — runs agent on the background loop
# ---------------------------------------------------------------------------

def run_agent_sync(
    agent: Agent,
    message: str,
) -> Tuple[str, Dict[str, Any]]:
    """Run the agent synchronously from a worker thread.

    Returns (response_text, meta_dict).
    Emits agent.start / agent.end events to event_bus.
    """
    rid = event_bus.current_run_id()
    agent_name = getattr(agent, "name", None) or "agent"

    if rid:
        event_bus.publish_event(
            rid,
            {
                "type": "agent.start",
                "agent": agent_name,
                "level": "info",
                "message": f"{agent_name} started",
                "data": {},
            },
        )

    started = time.perf_counter()
    try:
        async def _invoke() -> Any:
            return await agent.run(message)

        response = _run_coro(_invoke())
    except Exception as ex:
        logger.exception("[agent.runtime] agent.run failed (agent=%s)", agent_name)
        if rid:
            event_bus.publish_event(
                rid,
                {
                    "type": "agent.error",
                    "agent": agent_name,
                    "level": "error",
                    "message": f"{agent_name} failed: {ex}",
                    "data": {"error": str(ex)},
                },
            )
        raise

    text = response.text or ""
    duration_ms = int((time.perf_counter() - started) * 1000)

    # Extract usage from response
    usage = getattr(response, "usage_details", None) or {}
    if not isinstance(usage, dict):
        usage = {}

    prompt_tokens = int(usage.get("input_token_count") or 0)
    completion_tokens = int(usage.get("output_token_count") or 0)
    total_tokens = (
        int(usage.get("total_token_count") or 0)
        or (prompt_tokens + completion_tokens)
    )

    meta: Dict[str, Any] = {
        "model": settings.azure_openai_deployment,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "duration_ms": duration_ms,
    }

    if rid:
        event_bus.publish_event(
            rid,
            {
                "type": "agent.end",
                "agent": agent_name,
                "level": "info",
                "message": f"{agent_name} finished ({total_tokens} tok · {duration_ms}ms)",
                "data": meta,
            },
        )

    logger.info(
        "[agent.runtime] done agent=%s tokens=%d duration=%dms",
        agent_name,
        total_tokens,
        duration_ms,
    )
    return text, meta
