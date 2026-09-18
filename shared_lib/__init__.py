"""
EY RAID shared library.

Cross-cutting helpers reused by all 4 RAID backends (admin, analyzer, codegen,
enduser). Install with::

    pip install -e ../../shared_lib

Submodules:

* ``shared_lib.auth`` - FastAPI dependencies for the header-stub auth model
  (X-User-Id / X-User-Name / X-User-Role). Same shape as the existing
  ``analyzer_backend/auth_deps.py`` so the analyzer can switch over without
  call-site changes.
* ``shared_lib.audit`` - fire-and-forget audit emitter. Writes directly to
  Cosmos ``audit_events`` (PK ``/tenant_id``) when configured; no-ops with a
  warning when Cosmos is not configured.
* ``shared_lib.storage`` - small Cosmos client helper for the 3 new backends
  (admin/codegen/enduser). The analyzer keeps its own richer client for now
  (richer indexing/vector policies); a future iteration will consolidate.
* ``shared_lib.usage`` - daily telemetry rollups in the ``telemetry_daily``
  Cosmos container. Any subsystem can ``record_daily(...)`` after work; admin
  reads back via ``query_daily(...)`` for the telemetry dashboard.
* ``shared_lib.agents_runtime`` - single Azure OpenAI ChatClient + sync agent
  runner shared across subsystems.
"""

__version__ = "0.1.0"
