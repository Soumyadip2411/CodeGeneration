"""Azure OpenAI text client for the SDD generator (codegen_backend).

Provides the single ``generate(prompt, system_instruction)`` entry point that
every SDD agent calls. Replaces the standalone tool's LangChain-based client
with the ``openai`` SDK wired to the codegen backend's Azure settings, so no
LangChain dependency is added to the service.
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

from config import settings

logger = logging.getLogger(__name__)

_client = None
_deployment: Optional[str] = None


def _get_client() -> Tuple[object, str]:
    global _client, _deployment

    if _client is None:
        if not settings.azure_openai_endpoint or not settings.azure_openai_key:
            raise RuntimeError(
                "SDD generator: AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY must be set."
            )

        from openai import AzureOpenAI  # lazy import

        _client = AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint.rstrip("/"),
            api_key=settings.azure_openai_key,
            api_version=settings.azure_openai_api_version,
        )
        _deployment = settings.azure_openai_deployment
        logger.info(
            "[sdd.ai] Azure OpenAI client ready deployment=%s",
            _deployment,
        )

    return _client, _deployment  # type: ignore[return-value]


def generate(
    prompt: str,
    system_instruction: str = "",
    temperature: float = 0.4,
) -> str:
    """Send a system+user prompt to Azure OpenAI and return the text response."""
    client, deployment = _get_client()

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system_instruction or ""},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        timeout=180,
    )

    return response.choices[0].message.content or ""
