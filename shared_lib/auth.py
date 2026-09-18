"""
RAID shared authentication dependency.

``header`` (default) is the interim stub. Every request is trusted to carry:
  * ``X-User-Id``   - owner identifier (used as Cosmos owner partition key).
  * ``X-User-Name`` - optional human-readable display name.
  * ``X-User-Role`` - one of ``admin | analyzer | codegen | enduser``.

Convenient for local dev; **must not** be used in production (any client can
spoof a role).

``entra`` - Microsoft Entra ID. Requests must carry a validated
``Authorization: Bearer <access-token>``. The token signature is verified
against the tenant's published JWKS keys, and audience + issuer are checked.
Identity and role are then read from the token claims, not from headers.

Because every backend imports its dependencies from this single module, the
swap from header-stub to Entra happens once and all four subsystems
(admin / analyzer / codegen / enduser) inherit it. Call sites that use
``Depends(current_user_id)`` / ``Depends(current_role)`` /
``Depends(require_role(...))`` do not change.

Environment variables (read at import time):
    AUTH_MODE             header | entra                 (default: header)
    ENTRA_TENANT_ID       tenant GUID                    (required when entra)
    ENTRA_API_AUDIENCE    api://<app-id> or <app-id>     (required when entra)
    ENTRA_ISSUER          override issuer                (optional; derived)
    ENTRA_JWKS_URL        override JWKS endpoint         (optional; derived)
    ENTRA_ROLE_CLAIM      claim holding app roles        (default: roles)
    ENTRA_GROUPS_CLAIM    group claim                    (default: groups)
    ENTRA_REQUIRE_APP_ROLE reject tokens without an app role (default: true)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status


DEFAULT_USER_ID = "local-user"
DEFAULT_ROLE = "analyzer"
VALID_ROLES: tuple[str, ...] = ("admin", "analyzer", "codegen", "enduser")


# ---------------------------------------------------------------------------
# Auth configuration (env-driven; no dependency on per-backend config.py)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AuthConfig:
    mode: str = os.getenv("AUTH_MODE", "header").strip().lower()
    tenant_id: Optional[str] = os.getenv("ENTRA_TENANT_ID")
    audience: Optional[str] = os.getenv("ENTRA_API_AUDIENCE")
    issuer_override: Optional[str] = os.getenv("ENTRA_ISSUER")
    jwks_override: Optional[str] = os.getenv("ENTRA_JWKS_URL")
    role_claim: str = os.getenv("ENTRA_ROLE_CLAIM", "roles")
    groups_claim: str = os.getenv("ENTRA_GROUPS_CLAIM", "groups")
    require_app_role: bool = (
        os.getenv("ENTRA_REQUIRE_APP_ROLE", "true").strip().lower()
        not in ("0", "false", "no")
    )

    @property
    def is_entra(self) -> bool:
        return self.mode == "entra"

    @property
    def issuer(self) -> Optional[str]:
        if self.issuer_override:
            return self.issuer_override
        if self.tenant_id:
            # v2.0 access tokens issued by Entra ID
            return f"https://login.microsoftonline.com/{self.tenant_id}/v2.0"
        return None

    @property
    def jwks_url(self) -> Optional[str]:
        if self.jwks_override:
            return self.jwks_override
        if self.tenant_id:
            return (
                f"https://login.microsoftonline.com/"
                f"{self.tenant_id}/discovery/v2.0/keys"
            )
        return None


_config = AuthConfig()


# ---------------------------------------------------------------------------
# Principal - the resolved caller identity, mode-agnostic
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Principal:
    user_id: str
    role: str
    name: Optional[str] = None
    # Group object ids the caller belongs to (Entra ``groups`` claim, or the
    # ``X-User-Groups`` dev header). Used for group-shared data visibility.
    # Empty when the token carries no groups claim.
    groups: tuple[str, ...] = ()
    # Every RAID role the caller holds. The active role is always included
    # first. Authorization checks use this whole set so a user who holds,
    # e.g. both analyzer + codegen, is permitted on either.
    roles: tuple[str, ...] = ()

    @property
    def effective_roles(self) -> tuple[str, ...]:
        """All roles held, guaranteed non-empty (falls back to active role)."""
        return self.roles or (self.role,)


def _parse_groups(value) -> tuple[str, ...]:
    """Normalise a groups claim/header into a clean tuple of group ids."""
    if not value:
        return ()

    if isinstance(value, str):
        items = value.replace(",", " ").split()
    else:
        try:
            items = list(value)
        except TypeError:
            return ()

    out: list[str] = []
    for g in items:
        s = str(g).strip()
        if s and s not in out:
            out.append(s)
    return tuple(out)


def _coerce_role(value: Optional[str]) -> str:
    """Unknown/missing roles collapse to the default so a misbehaving client
    cannot escalate by sending arbitrary garbage.
    """
    role = (value or "").strip().lower()
    return role if role in VALID_ROLES else DEFAULT_ROLE


# ---------------------------------------------------------------------------
# Entra ID token validation (lazy - only imported/initialised in entra mode)
# ---------------------------------------------------------------------------

_jwks_client = None  # cached jwt.PyJWKClient


def _get_jwks_client():
    global _jwks_client

    if _jwks_client is None:
        import jwt  # PyJWT[crypto]; only required in entra mode

        if not _config.jwks_url:
            raise RuntimeError(
                "AUTH_MODE=entra requires ENTRA_TENANT_ID "
                "(or ENTRA_JWKS_URL) to be set."
            )

        _jwks_client = jwt.PyJWKClient(_config.jwks_url, cache_keys=True)

    return _jwks_client


def _validate_bearer(request: Request) -> Principal:
    import jwt  # PyJWT[crypto]

    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "MISSING_BEARER",
                "message": "Authorization: Bearer token required",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = header.split(" ", 1)[1].strip()

    if not _config.audience or not _config.issuer:
        raise RuntimeError(
            "AUTH_MODE=entra requires ENTRA_API_AUDIENCE and ENTRA_TENANT_ID "
            "(or ENTRA_ISSUER)."
        )

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=_config.audience,
            issuer=_config.issuer,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - surface as 401, never 500
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_TOKEN",
                "message": f"token validation failed: {exc}",
            },
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    # Identity: 'oid' is the stable, immutable Entra object id; fall back to
    # sub. A genuine Entra token always carries one of these. If neither is
    # present we REJECT rather than bucketing the caller into "local-user".
    user_id = (claims.get("oid") or claims.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "NO_SUBJECT",
                "message": "token has no subject (oid/sub); cannot establish identity",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    name = claims.get("name") or claims.get("preferred_username")

    # Role: Entra app roles arrive as a list in the 'roles' claim. Collect ALL
    # that map to ours (multi-role), and also fold in any 'groups' values that
    # are themselves RAID role names (mirrors the API's groups gate).
    role_values = claims.get(_config.role_claim) or []
    if isinstance(role_values, str):
        role_values = [role_values]

    roles: list[str] = []
    for candidate in role_values:
        c = str(candidate).strip().lower()
        if c in VALID_ROLES and c not in roles:
            roles.append(c)

    for g in _parse_groups(claims.get(_config.groups_claim)):
        gl = str(g).strip().lower()
        if gl in VALID_ROLES and gl not in roles:
            roles.append(gl)

    role = roles[0] if roles else None

    if role is None:
        # No recognised app role assigned to this user. In the App Roles model
        # "no role = no access", so reject rather than silently granting the
        # default. Set ENTRA_REQUIRE_APP_ROLE=false to fall back to the default.
        if _config.require_app_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "NO_APP_ROLE",
                    "message": (
                        "no RAID app role assigned to this user; "
                        "contact an administrator"
                    ),
                },
            )
        role = DEFAULT_ROLE

    return Principal(
        user_id=user_id,
        role=role,
        name=name.strip() if isinstance(name, str) and name.strip() else None,
        groups=_parse_groups(claims.get(_config.groups_claim)),
        roles=tuple(roles) if roles else (role,),
    )


# ---------------------------------------------------------------------------
# Core dependency - resolves a Principal in whichever mode is active
# ---------------------------------------------------------------------------

def get_principal(request: Request) -> Principal:
    """Resolve the caller identity for the active auth mode.

    ``entra`` - validate the bearer token and read claims.
    ``header`` - trust the ``X-User-*`` headers (dev stub).
    """
    if _config.is_entra:
        return _validate_bearer(request)

    user_id = (
        request.headers.get("X-User-Id") or DEFAULT_USER_ID
    ).strip() or DEFAULT_USER_ID

    raw_name = request.headers.get("X-User-Name")
    name = raw_name.strip() if raw_name and raw_name.strip() else None

    role = _coerce_role(request.headers.get("X-User-Role"))
    groups = _parse_groups(request.headers.get("X-User-Groups"))

    # Full role set for multi-role dev users ("X-User-Roles: analyzer,codegen");
    # the active role is always included first.
    extra_roles = [
        str(r).strip().lower()
        for r in _parse_groups(request.headers.get("X-User-Roles"))
        if str(r).strip().lower() in VALID_ROLES
    ]
    roles = tuple(dict.fromkeys([role, *extra_roles]))

    return Principal(user_id=user_id, role=role, name=name, groups=groups, roles=roles)


# ---------------------------------------------------------------------------
# Public dependencies - unchanged signatures for existing call sites
# ---------------------------------------------------------------------------

def current_user_id(
    principal: Principal = Depends(get_principal),
) -> str:
    """Returns the caller's user id (Entra ``oid`` or stub header)."""
    return principal.user_id


def current_user_name(
    principal: Principal = Depends(get_principal),
) -> Optional[str]:
    """Optional display name companion to the user id."""
    return principal.name


def current_role(
    principal: Principal = Depends(get_principal),
) -> str:
    """Returns the caller's role; falls back to ``analyzer``."""
    return principal.role


def current_user_roles(
    principal: Principal = Depends(get_principal),
) -> list[str]:
    """Every RAID role the caller holds (multi-role aware). Single-role
    callers get a one-element list; authorization uses this via require_role.
    """
    return list(principal.effective_roles)


def current_user_groups(
    principal: Principal = Depends(get_principal),
) -> list[str]:
    """Returns the group ids the caller belongs to (Entra ``groups`` claim or
    the ``X-User-Groups`` dev header); empty when none are present.
    """
    return list(principal.groups)


def require_role(*allowed: str):
    """Factory for a FastAPI dependency that rejects callers without an
    allowed role. Works identically in both auth modes.

    Usage:
        @router.post("/api/admin/something",
                     dependencies=[Depends(require_role("admin"))])
        async def admin_only(...):
            ...
    """
    allowed_set = {r.lower() for r in allowed}

    def _guard(
        principal: Principal = Depends(get_principal),
    ) -> str:
        held = set(principal.effective_roles)

        if not allowed_set.intersection(held):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "ROLE_FORBIDDEN",
                    "message": (
                        f"none of the caller's roles {sorted(held)} are permitted; "
                        f"expected one of {sorted(allowed_set)}"
                    ),
                },
            )

        # Prefer the active role when it qualifies; otherwise return the first
        # matching held role.
        return (
            principal.role
            if principal.role in allowed_set
            else sorted(allowed_set & held)[0]
        )

    return _guard
