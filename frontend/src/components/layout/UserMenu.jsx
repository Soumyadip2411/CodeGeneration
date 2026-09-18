import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, AtSign, Building2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { useRole, ROLE_LABELS, ROLE_VALUES } from '../../contexts/RoleContext';
import { getUserPhotoUrl } from '../../auth/entraAuth';

// The organisation / group the signed-in user belongs to. Previously a static
// "EY Internal" badge in the header - now surfaced inside the user popup.
const ORG_NAME = 'EY Internal';

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, photo, size }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        className="flex-shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}

function DetailRow({ icon: Icon, label, value, badge = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="flex-shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          badge
            ? 'ml-auto truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium capitalize text-primary'
            : 'ml-auto max-w-[60%] truncate text-xs font-medium text-foreground'
        }
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Header user button + account popup.
 *
 * Replaces the old role dropdown and the static "EY Internal" badge with a
 * single user button (avatar + name) that opens a popup showing the user's
 * photo, name, login, group and role, plus a sign-out action. In dev/header
 * mode the role can still be switched (for testing the role-aware sidebar);
 * under Entra the role is read-only (it comes from the validated token).
 */
export function UserMenu() {
  const { isEntraEnabled, displayName, userName, userId, role, hasAppRole, logout } = useAuth();
  const { label: roleLabel, canSwitchRoles, setRole, role: currentRole } = useRole();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState(null);
  const wrapRef = useRef(null);

  const name = displayName || userName || userId || 'User';
  const login = userName || userId || '-';

  // Best-effort Entra profile photo (graceful fallback to initials).
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    if (isEntraEnabled) {
      getUserPhotoUrl()
        .then((url) => {
          if (cancelled) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
          setPhoto(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
      }
    };
  }, [isEntraEnabled]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (ev) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    if (isEntraEnabled) {
      await logout();
      return;
    }
    // Dev/header mode has no real session - clear the stub identity and reload.
    try {
      ['euc_userId', 'euc_userName', 'euc_role'].forEach((k) => window.localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    window.location.reload();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Account"
        className="flex h-9 items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-2.5 text-foreground transition-colors hover:bg-secondary"
      >
        <Avatar name={name} photo={photo} size={26} />
        <span className="hidden max-w-[140px] truncate text-sm font-medium sm:inline">{name}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          >
            {/* Identity header */}
            <div className="flex items-center gap-3 border-b border-border bg-secondary/30 px-4 py-3.5">
              <Avatar name={name} photo={photo} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                <p className="truncate text-xs text-muted-foreground" title={login}>{login}</p>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2.5 px-4 py-3">
              <DetailRow icon={AtSign} label="Login" value={login} />
              <DetailRow icon={Building2} label="Group" value={ORG_NAME} />
              <DetailRow icon={ShieldCheck} label="Role" value={roleLabel || role || '-'} badge />

              {isEntraEnabled && !hasAppRole && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle size={12} /> No RAID app role assigned.
                </p>
              )}

              {canSwitchRoles && (
                <div className="pt-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Switch role (dev)
                  </label>
                  <select
                    value={currentRole}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {ROLE_VALUES.map((value) => (
                      <option key={value} value={value}>{ROLE_LABELS[value]}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Sign out */}
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut size={15} />
              {isEntraEnabled ? 'Sign out' : 'Reset dev identity'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default UserMenu;