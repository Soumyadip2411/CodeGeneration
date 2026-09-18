"""
Shared Cosmos storage helpers for RAID subsystems.

Usage::

    from shared_lib.storage import ContainerSpec, bootstrap, get_container

    SPECS = (
        ContainerSpec("tenant_config", "/tenant_id"),
        ContainerSpec("users", "/tenant_id"),
    )

    # at FastAPI startup:
    bootstrap(SPECS)

    # at request time:
    container = get_container("tenant_config")
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ContainerSpec:
    name: str
    partition_key: str  # e.g. "/tenant_id"


_lock = threading.Lock()
_client: Any = None
_database: Any = None
_containers: Dict[str, Any] = {}


def cosmos_endpoint() -> Optional[str]:
    return os.getenv("COSMOS_ENDPOINT")


def cosmos_key() -> Optional[str]:
    return os.getenv("COSMOS_KEY")


def cosmos_database() -> str:
    return os.getenv("COSMOS_DATABASE", "euc")


def is_cosmos_enabled() -> bool:
    return bool(cosmos_endpoint() and cosmos_key())


def get_client() -> Any:
    """Return a cached azure-cosmos client. Raises if Cosmos is not configured."""
    global _client

    if _client is not None:
        return _client

    if not is_cosmos_enabled():
        raise RuntimeError(
            "Cosmos is not configured - set COSMOS_ENDPOINT and COSMOS_KEY"
        )

    with _lock:
        if _client is not None:
            return _client

        from azure.cosmos import CosmosClient

        _client = CosmosClient(
            cosmos_endpoint(),
            credential=cosmos_key(),
        )
        logger.info(
            "[shared_lib.storage] connected endpoint=%s",
            cosmos_endpoint(),
        )
        return _client


def bootstrap(specs: Iterable[ContainerSpec]) -> List[str]:
    """Idempotently create the database and the given containers.

    Returns the list of container names that are ready (regardless of whether
    they were created now or already existed). Returns an empty list when
    Cosmos is not configured - callers should gate features on
    ``is_cosmos_enabled()`` separately.
    """
    global _database

    if not is_cosmos_enabled():
        logger.info(
            "[shared_lib.storage] bootstrap skipped - COSMOS_* not set"
        )
        return []

    from azure.cosmos import PartitionKey

    client = get_client()

    _database = client.create_database_if_not_exists(
        id=cosmos_database()
    )
    logger.info(
        "[shared_lib.storage] database ready name=%s",
        cosmos_database(),
    )

    ready: List[str] = []

    for spec in specs:
        container = _database.create_container_if_not_exists(
            id=spec.name,
            partition_key=PartitionKey(path=spec.partition_key),
        )

        _containers[spec.name] = container
        ready.append(spec.name)

        logger.info(
            "[shared_lib.storage] container ready name=%s pk=%s",
            spec.name,
            spec.partition_key,
        )

    return ready


def get_container(name: str) -> Any:
    """Return a cached container proxy. Raises if it hasn't been bootstrapped."""
    if name in _containers:
        return _containers[name]

    raise RuntimeError(
        f"Container '{name}' not bootstrapped - "
        "call shared_lib.storage.bootstrap(...) at startup."
    )


def health() -> Tuple[bool, Dict[str, Any]]:
    """Returns ``(ok, info)`` suitable for /api/health endpoints."""
    info = {
        "cosmos_configured": is_cosmos_enabled(),
        "containers_ready": sorted(_containers.keys()),
        "database": cosmos_database() if is_cosmos_enabled() else None,
    }
    return is_cosmos_enabled(), info
