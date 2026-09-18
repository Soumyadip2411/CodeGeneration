"""CodeGen backend configuration.

Mirrors the analyzer / admin typed-dataclass pattern.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    service_name: str = field(
        default_factory=lambda: os.getenv("CODEGEN_SERVICE_NAME", "raid-codegen")
    )
    port: int = field(
        default_factory=lambda: int(os.getenv("CODEGEN_PORT", "7073"))
    )

    # Upstream / downstream
    analyzer_base_url: str = field(
        default_factory=lambda: os.getenv(
            "ANALYZER_BASE_URL", "http://localhost:7071"
        )
    )
    enduser_base_url: str = field(
        default_factory=lambda: os.getenv(
            "ENDUSER_BASE_URL", "http://localhost:7074"
        )
    )

    # Cosmos (owns: codegen-workflows, codegen-files, codegen-events)
    cosmos_endpoint: Optional[str] = field(
        default_factory=lambda: os.getenv("COSMOS_ENDPOINT")
    )
    cosmos_key: Optional[str] = field(
        default_factory=lambda: os.getenv("COSMOS_KEY")
    )
    cosmos_database: str = field(
        default_factory=lambda: os.getenv("COSMOS_DATABASE", "euca")
    )

    # Blob Storage
    azure_storage_connection_string: Optional[str] = field(
        default_factory=lambda: os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    )
    artifacts_container: str = field(
        default_factory=lambda: os.getenv(
            "CODEGEN_ARTIFACTS_CONTAINER", "codegen-artifacts"
        )
    )

    # Local workspace root - agent writes generated code here temporarily before
    # uploading to Blob. Cleaned up after successful upload.
    workspace_root: str = field(
        default_factory=lambda: os.getenv(
            "CODEGEN_WORKSPACE_ROOT",
            str(Path(__file__).resolve().parent.parent / "workspace" / "codegen"),
        )
    )

    # Azure OpenAI (for agent LLM calls)
    azure_openai_endpoint: Optional[str] = field(
        default_factory=lambda: os.getenv("AZURE_OPENAI_ENDPOINT")
    )
    azure_openai_key: Optional[str] = field(
        default_factory=lambda: os.getenv("AZURE_OPENAI_KEY")
    )
    azure_openai_deployment: Optional[str] = field(
        default_factory=lambda: os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
    )
    azure_openai_api_version: str = field(
        default_factory=lambda: os.getenv(
            "AZURE_OPENAI_API_VERSION", "2025-04-01-preview"
        )
    )

    @property
    def cosmos_configured(self) -> bool:
        return bool(self.cosmos_endpoint and self.cosmos_key)

    @property
    def blob_configured(self) -> bool:
        return bool(self.azure_storage_connection_string)

    @property
    def llm_configured(self) -> bool:
        return bool(self.azure_openai_endpoint and self.azure_openai_key)


settings = Settings()
