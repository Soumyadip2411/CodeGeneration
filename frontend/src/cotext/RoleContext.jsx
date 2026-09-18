import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentAuthSnapshot, isEntraAuthEnabled, setActiveRole as applyActiveRole } from '../auth/entraAuth';
import { useAuth } from './AuthContext';

/**
 * Role context - interim Entra ID stub.
 *
 * Persists the currently selected user role in localStorage so a page refresh
 * keeps the same role. Sent to every backend as the `X-User-Role` header by
 * the axios interceptor in src/api/client.js. When Entra ID lands, the JWT
 * validator on each backend will overwrite the header with the validated
 * claim, but the same `useRole()` hook keeps working unchanged.
 *
 * Default role is `analyzer` so the existing analyzer flow is unchanged for
 * users who first see the role switcher.
 */

const STORAGE_KEY = 'euc_role';

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  ANALYZER: 'analyzer',
  CODEGEN: 'codegen',
  ENDUSER: 'enduser',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.ANALYZER]: 'Analyzer',
  [ROLES.CODEGEN]: 'Code Generator',
  [ROLES.ENDUSER]: 'End User',
});

const DEFAULT_ROLE = ROLES.ANALYZER;

const RoleContext = createContext(null);

function getInitialRole() {
  if (typeof window === 'undefined') return DEFAULT_ROLE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (ROLE_VALUES.includes(stored)) return stored;
  } catch { /* ignore */ }
  return DEFAULT_ROLE;
}

/** Synchronous read for non-React call sites (e.g. the axios interceptor). */
export function getCurrentRole() {
  if (isEntraAuthEnabled()) {
    return getCurrentAuthSnapshot().role;
  }
  return getInitialRole();
}

export function RoleProvider({ children }) {
  const auth = useAuth();

  // Every role the signed-in user holds (Entra token claims, or the dev role
  // set). Multi-role users get more than one; single-role users get exactly one.
  const effectiveRoles = useMemo(() => {
    const list = Array.isArray(auth.roles) && auth.roles.length
      ? auth.roles
      : [auth.role || DEFAULT_ROLE];
    const filtered = list.filter((r) => ROLE_VALUES.includes(r));
    return filtered.length ? Array.from(new Set(filtered)) : [DEFAULT_ROLE];
  }, [auth.roles, auth.role]);

  const rolesKey = effectiveRoles.join(',');

  const [activeRole, setActiveRoleState] = useState(() => getCurrentAuthSnapshot().role);

  // Keep the active role valid as the held-role set changes (login / switch).
  useEffect(() => {
    setActiveRoleState((prev) => {
      const next = effectiveRoles.includes(prev) ? prev : (effectiveRoles[0] || DEFAULT_ROLE);
      applyActiveRole(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

  const setActiveRole = useCallback((next) => {
    const role = String(next || '').toLowerCase();
    if (!effectiveRoles.includes(role)) return;
    applyActiveRole(role);
    setActiveRoleState(role);
  }, [effectiveRoles]);

  const value = useMemo(() => ({
    role: activeRole,
    roles: effectiveRoles,
    activeRole,
    setActiveRole,
    setRole: setActiveRole, // back-compat alias for existing call sites
    label: ROLE_LABELS[activeRole] || activeRole,
    // Switching is offered whenever the user holds more than one role, in BOTH
    // auth modes (the active role is the UI/nav context).
    canSwitchRoles: effectiveRoles.length > 1,
  }), [activeRole, effectiveRoles, setActiveRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}