import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Sun, Moon, LayoutGrid, FolderKanban, MoreVertical, Trash2, ChevronRight, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';
import { useEUCProjects } from '../../contexts/EUCProjectContext';
import HeaderActivity from './HeaderActivity';
import { UserMenu } from './UserMenu';
import { RoleSwitcher } from './RoleSwitcher';

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/projects': 'My Workflows',
  '/audit-log': 'Audit Log',
  '/exports': 'Asset Center',
  '/settings': 'Settings',
  '/inventory': 'EUC Inventory',
  '/insights': 'Insights',
  '/results': 'Analysis Results',
  '/codegen': 'Dashboard',
  '/codegen/workflows': 'My Workflows',
  '/codegen/artifacts': 'Artifacts Center',
  '/admin/tenant': 'Tenant Config',
  '/admin/infra': 'Infrastructure',
  '/admin/users': 'Users',
  '/admin/bulk': 'Bulk Ingest',
  '/admin/audit-log': 'Audit Log',
};

export function AppHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { getProject, deleteProject } = useEUCProjects();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Detect a workflow detail route: /projects/<id>[/...] (the list page has no id).
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const eucId = match ? match[1] : null;
  const project = eucId ? getProject(eucId) : null;

  const title =
    PAGE_TITLES[pathname] ??
    Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] ??
    'EUC RAID';

  const handleDelete = async () => {
    if (!eucId || deleting) return;
    setDeleting(true);
    try {
      await deleteProject(eucId);
      setConfirmDelete(false);
      navigate('/projects');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-6 backdrop-blur-sm">
      {/* Left - workflow breadcrumb when inside a workflow, else the page title */}
      {project ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            to="/projects"
            className="flex flex-shrink-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <LayoutGrid size={13} />
            <span className="text-xs font-medium">My Workflows</span>
          </Link>
          <ChevronRight size={13} className="flex-shrink-0 text-muted-foreground/50" />
          <FolderKanban size={20} className="flex-shrink-0 text-primary" />
          <h1 className="truncate text-base font-semibold text-foreground">{project.name}</h1>
        </div>
      ) : (
        <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
      )}

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        <HeaderActivity />

        {project && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-secondary"
            >
              <MoreVertical size={14} />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute right-0 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-lg z-50"
                >
                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 rounded-md"
                  >
                    <Trash2 size={14} /> Delete Workflow
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-secondary"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <RoleSwitcher />
        <UserMenu />
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDelete && project && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(false)} />
            <motion.div
              className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10">
                <Trash2 size={18} className="text-destructive" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Delete this workflow?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{project.name}</span> and all its files & runs will be removed. This cannot be undone.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting...</> : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}