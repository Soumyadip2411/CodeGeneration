"""SDD (Solution Design Document) generator - codegen integration.

Ported from the standalone EUC_SDD_GENERATOR (a 5-agent pipeline:
interpreter -> analysis -> solution options -> architecture -> proposal) to RAAD
codegen standards.

* LangChain and Streamlit removed; Azure OpenAI via ``config.settings``
  (see ``ai_client.generate``).
* Runs one-shot — ``orchestrator.run_pipeline`` auto-accepts the AI's
  recommended solution option (no interactive human-in-the-loop step), which
  suits a "Download SDD" button.
* Produces an EY-branded ``.docx`` (cover, table of contents, proposal,
  architecture diagram rendered with Pillow, and an appendix) via
  ``doc_generator.generate_word_doc``.

Public surface::

    generate_sdd_docx(process_description, current_challenges, system_constraints) -> bytes
"""
from __future__ import annotations

from .doc_generator import generate_word_doc
from .orchestrator import run_pipeline


def generate_sdd_docx(
    process_description: str,
    current_challenges: str = "",
    system_constraints: str = "",
) -> bytes:
    """Run the 5-agent pipeline and return the full Solution Design Document as ``.docx`` bytes."""
    results = run_pipeline(
        process_description,
        current_challenges,
        system_constraints,
    )
    return generate_word_doc(results)


__all__ = ["generate_sdd_docx", "run_pipeline", "generate_word_doc"]
