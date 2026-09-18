import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, FolderKanban, Calendar, Code2,
  Activity, ArrowRight, CheckCircle2, Clock, AlertCircle,
  LayoutGrid, List, MoreVertical, Trash2, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  listWorkflows, deleteWorkflow,
  WORKFLOW_STATUS_META,
} from '../../api/codegen';
import CreateWorkflowModal from '../../components/codegen/CreateWorkflowModal';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/utils';

/* — Animation presets (same as analyzer ProjectsPage) — */
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};

const cardVariant = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 22 } },
  exit: { opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.2 } },
};

/* — Status helpers — */
const runStatusMeta = {
  completed: { icon: CheckCircle2, label: 'Complete', cls: 'text-emerald-600' },
  cancelled: { icon: X,            label: 'Cancelled',cls: 'text-orange-600' },
  running:   { icon: Activity,     label: 'Running',  cls: 'text-amber-600' },
  failed:    { icon: AlertCircle,  label: 'Failed',   cls: 'text-red-600' },
  paused:    { icon: Clock,        label: 'Paused',   cls: 'text-amber-600' },
  queued:    { icon: Clock,        label: 'Queued',   cls: 'text-muted-foreground' },
  null:      { icon: Clock,        label: 'Not run',  cls: 'text-muted-foreground' },
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* — Workflow card (mirrors analyzer ProjectCard) — */
function WorkflowCard({ workflow, onOpen, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sm = WORKFLOW_STATUS_META[workflow.status] || WORKFLOW_STATUS_META.created;
  const am = runStatusMeta[workflow.status] || runStatusMeta.null;
  const RunIcon = am.icon;

  return (
    <motion.div
      variants={cardVariant}
      className="relative rounded-xl border border-border bg-card hover:border-yellow-400/40 hover:shadow-[0_0_28px_rgba(255,215,0,0.15)] transition-all duration-300 overflow-hidden cursor-pointer group"
      onClick={() => onOpen(workflow.id)}
    >
      {/* EY yellow left-edge accent */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-gradient-to-b from-[rgba(255,215,0,0.85)] via-[rgba(255,215,0,0.35)] to-transparent" />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 flex-shrink-0">
              <Code2 size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate text-sm">{workflow.name || 'Untitled Workflow'}</h3>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{workflow.primary_usage || 'No usage specified'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Status pill */}
            <span className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
              sm.color === 'bg-emerald-500' ? 'bg-emerald-50 text-emerald-600' :
              sm.color === 'bg-sky-500' ? 'bg-sky-50 text-sky-600' :
              sm.color === 'bg-amber-500' ? 'bg-amber-50 text-amber-600' :
              sm.color === 'bg-red-500' ? 'bg-red-50 text-red-600' :
              'bg-secondary text-muted-foreground',
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', sm.color)} />
              {sm.label}
            </span>

            {/* More menu */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded p-1 text-muted-foreground hover:bg-secondary transition-colors opacity-0 group-hover:opacity-100"
              >
                <MoreVertical size={15} />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.92, y: -4 }}
                    className="absolute right-0 top-7 z-50 min-w-[140px] rounded-lg border border-border bg-card shadow-xl py-1"
                  >
                    <button
                      onClick={() => { setMenuOpen(false); onDelete(workflow.id); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Description */}
        {workflow.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">{workflow.description}</p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <Code2 size={12} />
            {workflow.file_count} file{workflow.file_count === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1" title={`Created ${formatDate(workflow.created_at)}`}>
            <Calendar size={12} />
            {workflow.updated_at && workflow.updated_at !== workflow.created_at
              ? `Updated ${formatDate(workflow.updated_at)}`
              : formatDate(workflow.created_at)}
          </span>
          <span className={cn('flex items-center gap-1', am.cls)}>
            <RunIcon size={12} className={workflow.latest_run_status === 'running' ? 'animate-spin' : ''} />
            {am.label}
          </span>
        </div>

        {/* Notes tag */}
        {workflow.notes && (
          <div className="flex items-center gap-1.5 mb-4">
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground truncate max-w-[200px]">
              {workflow.notes}
            </span>
          </div>
        )}

        {/* Open button */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {workflow.run_count} run{workflow.run_count === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-primary group-hover:gap-2 transition-all duration-200">
            Open <ArrowRight size={13} />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* — Card skeleton — */
function WorkflowCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-secondary" />
      <div className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-10 w-10 flex-shrink-0 rounded-xl" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-3.5 w-32 rounded" />
              <Skeleton className="h-2.5 w-24 rounded" />
            </div>
          </div>
          <Skeleton className="h-5 w-20 flex-shrink-0 rounded-full" />
        </div>
        <div className="mb-3 space-y-2">
          <Skeleton className="h-2.5 w-full rounded" />
          <Skeleton className="h-2.5 w-4/5 rounded" />
        </div>
        <div className="mb-4 flex items-center gap-4">
          <Skeleton className="h-2.5 w-16 rounded" />
          <Skeleton className="h-2.5 w-20 rounded" />
          <Skeleton className="h-2.5 w-16 rounded" />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Skeleton className="h-2.5 w-12 rounded" />
          <Skeleton className="h-2.5 w-14 rounded" />
        </div>
      </div>
    </div>
  );
}

/* — Main page — */
export default function CodeGenWorkflowsPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('grid');

  useEffect(() => {
    setLoading(true);
    listWorkflows()
      .then(setWorkflows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = workflows.filter(
    (w) =>
      !search.trim() ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (w.primary_usage || '').toLowerCase().includes(search.toLowerCase()) ||
      (w.business_unit || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleOpen = (id) => navigate(`/codegen/workflows/${id}`);

  const handleDelete = async (id) => {
    if (window.confirm('Delete this workflow? This action cannot be undone.')) {
      await deleteWorkflow(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    }
  };

  const handleCreated = (wf) => {
    setShowCreate(false);
    navigate(`/codegen/workflows/${wf.id}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
            <FolderKanban size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">My Workflows</h2>
            <p className="text-xs text-muted-foreground">
              {workflows.length} workflow{workflows.length === 1 ? '' : 's'} · {workflows.filter((w) => w.status === 'completed').length} completed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-border bg-secondary p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={cn('rounded p-1.5 transition-colors', viewMode === 'grid' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('rounded p-1.5 transition-colors', viewMode === 'list' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              <List size={14} />
            </button>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={15} /> New Workflow
          </button>
        </div>
      </div>

      {/* Search bar */}
      {workflows.length > 0 && (
        <div className="border-b border-border bg-card/50 px-8 py-3">
          <div className="relative max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workflows..."
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading && workflows.length === 0 ? (
          <div className={cn('gap-5', viewMode === 'grid' ? 'grid sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : 'flex flex-col')}>
            {Array.from({ length: 6 }).map((_, i) => <WorkflowCardSkeleton key={i} />)}
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
              <Code2 size={36} className="text-primary" />
            </div>
            <div>
              <p className="text-xl font-semibold text-foreground">No workflows yet</p>
              <p className="mt-2 text-sm text-muted-foreground max-w-xs">
                Create your first code generation workflow to start producing production-quality code from your PDDs.
              </p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} /> Create New Workflow
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <Search size={32} className="text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">No results for &ldquo;{search}&rdquo;</p>
            <button onClick={() => setSearch('')} className="text-sm text-primary hover:underline">Clear search</button>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className={cn('gap-5', viewMode === 'grid' ? 'grid sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : 'flex flex-col')}
          >
            <AnimatePresence>
              {filtered.map((w) => (
                <WorkflowCard key={w.id} workflow={w} onOpen={handleOpen} onDelete={handleDelete} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateWorkflowModal
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}