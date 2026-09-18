"""Spec / Artifact / Capability - Pydantic models for the Cosmos documents.

Containers:

- "specs"       - PK "/tenant_id". One document per accepted PDD handoff.
- "capabilities" - PK "/tenant_id". One document per published MCP tool.

Artifacts live inline on the parent "Spec" (one document per spec is fine
for the volumes we expect; if artifact growth becomes an issue, splitting
into a dedicated container is a non-breaking change because routes already
go through the repository).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SpecStatus(str, Enum):
    QUEUED = "queued"
    GENERATING = "generating"
    READY = "ready"
    PUBLISHED = "published"
    FAILED = "failed"


class CapabilityStatus(str, Enum):
    AVAILABLE = "available"
    DEPRECATED = "deprecated"


class Artifact(BaseModel):
    """One generated artifact attached to a spec (code file, MCP manifest, test, etc.)."""
    model_config = ConfigDict(extra="ignore")

    id: str
    kind: str  # "code" | "mcp_manifest" | "test" | "doc" | ...
    name: str
    blob_path: Optional[str] = None  # codegen-artifacts/<spec_id>/<id>
    content_type: Optional[str] = None
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    created_at: str = Field(default_factory=_now)


class Spec(BaseModel):
    """Approved-PDD handoff received from the Analyzer."""
    model_config = ConfigDict(extra="ignore")

    id: str
    tenant_id: str
    euc_id: str
    run_id: str

    pdd: Dict[str, Any]
    manifest: Dict[str, Any] = Field(default_factory=dict)

    status: SpecStatus = SpecStatus.QUEUED
    artifacts: List[Artifact] = Field(default_factory=list)

    capability_id: Optional[str] = None  # set on publish
    error: Optional[str] = None

    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)
    created_by: Optional[str] = None
    updated_by: Optional[str] = None


class SpecSubmit(BaseModel):
    """Request body for POST /api/specs."""
    model_config = ConfigDict(extra="ignore")

    tenant_id: str = Field(..., min_length=1)
    euc_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    pdd: Dict[str, Any]
    manifest: Optional[Dict[str, Any]] = None


class Capability(BaseModel):
    """Published MCP tool, consumed by the End User catalog."""
    model_config = ConfigDict(extra="ignore")

    id: str
    tenant_id: str
    spec_id: str

    name: str
    description: Optional[str] = None
    status: CapabilityStatus = CapabilityStatus.AVAILABLE

    mcp_tool_url: Optional[str] = None  # populated by the real generator
    mcp_manifest_blob_path: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None

    published_at: str = Field(default_factory=_now)
    published_by: Optional[str] = None
