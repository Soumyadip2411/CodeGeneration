import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  ClipboardList,
  Download,
  Settings,
  Sparkles,
  Building2,
  Server,
  UploadCloud,
  Users,
  Activity,
  MessageSquare,
} from 'lucide-react';
import { EYLogo } from '../EYLogo';
import { cn } from '../../lib/utils';
import { useState } from 'react';
import { ROLES, useRole } from '../../contexts/RoleContext';

// Analyzer is today's set - kept verbatim so the existing flow is unchanged.
const ANALYZER_NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'My Workflows', href: '/projects', icon: FolderKanban },
  { name: 'Insights', href: '/insights', icon: Sparkles },
  { name: 'Audit Log', href: '/audit-log', icon: ClipboardList },
  { name: 'Export Center', href: '/exports', icon: Download },
  { name: 'Settings', href: '/settings', icon: Settings },
];

// Admin-only pages (routes land in later iterations; for now they fall back to /dashboard).
const ADMIN_NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Tenant Config', href: '/admin/tenant', icon: Building2 },
  { name: 'Infrastructure', href: '/admin/infra', icon: Server },
  { name: 'Bulk Ingest', href: '/admin/bulk', icon: UploadCloud },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Telemetry', href: '/admin/telemetry', icon: Activity },
  { name: 'Audit Log', href: '/admin/audit-log', icon: ClipboardList },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const CODEGEN_NAV = [
  { name: 'Dashboard', href: '/codegen', icon: LayoutDashboard },
  { name: 'My Workflows', href: '/codegen/workflows', icon: FolderKanban },
  { name: 'Artifacts Center', href: '/codegen/artifacts', icon: Download },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const ENDUSER_NAV = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Capabilities', href: '/enduser/capabilities', icon: Sparkles },
  { name: 'Chat', href: '/enduser/chat', icon: MessageSquare },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const NAV_BY_ROLE = {
  [ROLES.ANALYZER]: ANALYZER_NAV,
  [ROLES.ADMIN]: ADMIN_NAV,
  [ROLES.CODEGEN]: CODEGEN_NAV,
  [ROLES.ENDUSER]: ENDUSER_NAV,
};

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(true);
  const location = useLocation();
  const { role } = useRole();

  const navItems = NAV_BY_ROLE[role] || ANALYZER_NAV;

  return (
    <aside
      onMouseEnter={() => setCollapsed(false)}
      onMouseLeave={() => setCollapsed(true)}
      className={cn(
        'fixed left-0 top-0 z-40 h-screen flex flex-col transition-all duration-300',
        'bg-sidebar border-r border-sidebar-border shadow-[4px_0_24px_rgba(0,0,0,0.35)]',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      {/* Subtle glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-10 -left-8 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />
      </div>

      {/* Logo */}
      <div
        className={cn(
          'relative z-10 flex h-16 items-center border-b border-sidebar-border px-4',
          collapsed ? 'justify-center' : 'justify-start',
        )}
      >
        {collapsed ? (
          <EYLogo variant="compact" inverted />
        ) : (
          <EYLogo inverted />
        )}
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex-1 space-y-1 overflow-y-auto px-2 py-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          // Exact match for root/dashboard-level links to prevent multiple active states
          const isExactDashboard = item.href === '/' || item.href === '/dashboard' || item.href === '/codegen';
          const isActive = isExactDashboard
            ? location.pathname === item.href
            : location.pathname.startsWith(item.href);

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                collapsed ? 'justify-center' : 'justify-start',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
              title={collapsed ? item.name : undefined}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.name}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative z-10 border-t border-sidebar-border p-3">
        {!collapsed && (
          <p className="text-xs text-sidebar-foreground/40 text-center">EY · EUC RAID</p>
        )}
      </div>
    </aside>
  );
}