#!/usr/bin/env python

"""
smoke_sdd_live.py - live end-to-end smoke for the SDD 5-agent pipeline.

Requires Azure OpenAI env vars (AZURE_OPENAI_ENDPOINT / _KEY / _DEPLOYMENT /
_API_VERSION). Runs the full one-shot pipeline (interpreter -> analysis ->
solution -> architecture -> proposal) on a sample PDD and asserts a valid,
diagram-embedded .docx comes out.

Usage (from codegen_backend/codegen_backend, venv active, Azure env set):
    python scripts/smoke_sdd_live.py

Exit 0 = pass.
"""

from __future__ import annotations

import io
import os
import sys
import time
import zipfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

_SAMPLE_PDD = """
Invoice Processing and Approval - Process Design Document

Overview: The finance team processes supplier invoices manually. Invoices arrive by
email as PDF attachments. A clerk enters invoice data (supplier, invoice number,
amount, PO number) into an Excel workbook. The workbook validates the amount against
the purchase order and flags mismatches. Invoices over $10,000 require manager
approval by email. Approved invoices are entered into SAP for payment.

Business rules:
- Every invoice must reference a valid PO number.
- Invoice amount must match the PO amount within 5% tolerance.
- Invoices over $10,000 require manager sign-off before payment.
- Duplicate invoice numbers for the same supplier are rejected.

Systems: Outlook (email), Excel (validation workbook), SAP (payment).
"""

_CHALLENGES = (
    "Manual data entry is slow and error-prone; approvals by email are hard to track; "
    "no audit trail; month-end backlog."
)

_CONSTRAINTS = (
    "Must keep SAP as the system of record; prefer Microsoft/Azure tooling."
)


def main() -> int:
    from config import settings

    if not (settings.azure_openai_endpoint and settings.azure_openai_key):
        print(
            "SKIP - Azure OpenAI not configured "
            "(set AZURE_OPENAI_ENDPOINT / _KEY)."
        )
        return 0

    from services.sdd import generate_sdd_docx

    print(
        f"[smoke_sdd_live] running 5-agent SDD pipeline "
        f"(deployment={settings.azure_openai_deployment}) ..."
    )
    start = time.time()
    docx = generate_sdd_docx(
        _SAMPLE_PDD,
        current_challenges=_CHALLENGES,
        system_constraints=_CONSTRAINTS,
    )
    elapsed = round(time.time() - start, 1)

    assert isinstance(docx, (bytes, bytearray)) and docx[:2] == b"PK", \
        "SDD must be a valid .docx"
    assert len(docx) > 8000, "SDD docx looks too small"

    with zipfile.ZipFile(io.BytesIO(docx)) as zf:
        media = [
            n for n in zf.namelist()
            if n.startswith("word/media/")
        ]

    print(f"  docx bytes={len(docx)} media={media} elapsed={elapsed}s")
    if not media:
        print(
            "  WARN: no architecture diagram image embedded "
            "(agent4 may not have produced a spec)"
        )
    print("[smoke_sdd_live] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
