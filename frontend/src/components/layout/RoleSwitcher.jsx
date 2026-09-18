import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Check, Layers } from 'lucide-react';
import { ROLE_LABELS, ROLES, useRole } from '../../contexts/RoleContext';

const ROLE_DEFAULT_ROUTE = {
  [ROLES.ANALYZER]: '/dashboard',
  [ROLES.ADMIN]: '/admin/tenant',
  [ROLES.CODEGEN]: '/codegen',
  [ROLES.ENDUSER]: '/enduser/capabilities',
};

/**
 * Active-role switcher - shown before the user menu in the app header.
 *
 * A user can hold several roles (e.g. Analyzer + Code Generator). This dropdown
 * lists exactly the roles they hold and switches the ACTIVE one, which drives
 * the role-aware sidebar / navigation context. In Entra mode the token already
 * carries every role the user has, so switching changes the working context, not
 * the underlying access. Single-role users see a read-only label.
 */
export function RoleSwitcher() {
  const { roles, activeRole, setActiveRole, label, canSwitchRoles } = useRole();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (ev) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!canSwitchRoles) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground">
        <span className="text-[10px] uppercase tracking-wide">Role</span>
        <span className="text-foreground">{label}</span>
      </div>
    );
  }

  const pick = (value) => {
    setActiveRole(value);
    setOpen(false);
    navigate(ROLE_DEFAULT_ROUTE[value] || '/dashboard');
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch active role"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
      >
        <Layers size={13} className="text-primary" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Role</span>
        <span>{label}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-9 z-50 w-52 overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          <div className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Your roles ({roles.length})
          </div>
          {roles.map((value) => (
            <button
              type="button"
              key={value}
              role="option"
              aria-selected={value === activeRole}
              onClick={() => pick(value)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-secondary ${
                value === activeRole ? 'bg-secondary text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span>{ROLE_LABELS[value] || value}</span>
              {value === activeRole && <Check size={13} className="text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default RoleSwitcher;