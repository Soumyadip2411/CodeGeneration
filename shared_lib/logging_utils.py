"""Small logging helpers shared across RAID subsystems."""
from __future__ import annotations


def scrub_log(value: object) -> str:
    """Normalize log-forcing (CR/LF) in user-controlled values.

    Strips CR/LF so an attacker can't inject forged log lines via headers,
    ids or free text. Returns a single-line string safe to interpolate into
    log messages.
    """
    return str(value).replace("\n", " ").replace("\r", " ")
