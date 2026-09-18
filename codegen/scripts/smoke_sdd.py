#!/usr/bin/env python

"""
smoke_sdd.py - offline smoke for the SDD generator's rendering path.

Exercises the NON-LLM parts (no Azure needed):
  1. render the architecture diagram  -> services.sdd.diagram_renderer (Pillow PNG)
  2. build the full SDD .docx         -> services.sdd.doc_generator.generate_word_doc

The 5-agent LLM pipeline is covered by the live test; this proves the docx
assembly + diagram rendering work headlessly with a fabricated results dict.

Usage (from codegen_backend/codegen_backend, venv active):
    python scripts/smoke_sdd.py

Exit 0 = pass.
"""

from __future__ import annotations

import io
import os
import sys
import zipfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

_DIAGRAM_SPEC = {
    "layers": ["Input", "Validation", "Processing", "Output"],
    "components": [
        {"id": "api", "name": "API Handler (FastAPI)", "layer": "Input"},
        {"id": "val", "name": "Pydantic Validator", "layer": "Validation"},
        {"id": "proc", "name": "Business Logic (Python)", "layer": "Processing"},
        {"id": "out", "name": "Response Builder", "layer": "Output"},
    ],
    "connections": [
        {"source": "api", "target": "val", "label": "Request", "kind": "normal"},
        {"source": "val", "target": "proc", "kind": "normal"},
        {"source": "val", "target": "api", "label": "Invalid", "kind": "exception"},
        {"source": "proc", "target": "out", "kind": "normal"},
    ],
}

_PROPOSAL = """# Solution Design Proposal

## 1. Executive Summary

> A concise overview of the recommended solution.

| Field | Details |
|---|---|
| **Process Analyzed** | Loan Approval |
| **Domain** | Banking |
| **Recommended Solution** | Workflow Automation |

## 4. Recommended Solution

**Recommended Approach:** Workflow Automation

- ✅ Automates manual approval steps
- ✅ Adds an audit trail

## 5. Architecture Design

### Layer Breakdown

| Layer | Components | Data In | Data Out |
|---|---|---|---|
| Input | API Handler | Request | Validated request |
"""

def main() -> int:
    from services.sdd.diagram_renderer import render_architecture_png
    from services.sdd.doc_generator import generate_word_doc

    print("[smoke_sdd] rendering architecture diagram ...")
    png = render_architecture_png(_DIAGRAM_SPEC)
    assert (
        isinstance(png, (bytes, bytearray))
        and png[:8].startswith(b"\x89PNG")
    ), "diagram must be a PNG"
    assert len(png) > 1000, "diagram PNG looks too small"
    print(f"  diagram PNG bytes={len(png)} (valid)")

    results = {
        "process_breakdown": "# Process\n- Step 1\n- Step 2",
        "gap_analysis": "## Gaps\n| Risk | Level |\n|---|---|\n| Manual entry | High |",
        "solution_design": "# Solution\nWorkflow automation with Power Automate.",
        "architecture": "## Architecture Design\nLayered design.",
        "architecture_diagram_spec": _DIAGRAM_SPEC,
        "final_proposal": _PROPOSAL,
        "selected_option_name": "Workflow Automation",
    }

    print("[smoke_sdd] building SDD .docx ...")
    docx = generate_word_doc(results)
    assert (
        isinstance(docx, (bytes, bytearray))
        and docx[:2] == b"PK"
    ), "docx must be a valid zip/docx"
    assert len(docx) > 5000, "docx looks too small"
    print(f"  docx bytes={len(docx)} (valid)")

    # Confirm the architecture diagram image was embedded in the docx.
    with zipfile.ZipFile(io.BytesIO(docx)) as zf:
        media = [
            n for n in zf.namelist()
            if n.startswith("word/media/")
        ]

    assert media, "expected an architecture diagram image embedded in the docx"
    print(f"  embedded media={media}")

    print("[smoke_sdd] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
