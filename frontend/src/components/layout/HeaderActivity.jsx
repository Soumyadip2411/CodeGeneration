import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud, CheckCircle2, AlertCircle, Loader2, Cloud, ChevronDown, X,
  ListChecks, Activity, Sparkles, ArrowRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useEUCProjects } from '../../contexts/EUCProjectContext';

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(at) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

// Soft, theme-aware tones - no glare in dark mode.
const TONES = {
  status: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300', bg: 'bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-300' },
  done: { dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-300', bg: 'bg-sky-500/10', icon: 'text-sky-600 dark:text-sky-300' },
  upload: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-300', bg: 'bg-blue-500/10', icon: 'text-blue-600 dark:text-blue-300' },
  run: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-300', bg: 'bg-amber-500/10', icon: 'text-amber-600 dark:text-amber-300' },
  review: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-300', bg: 'bg-violet-500/10', icon: 'text-violet-600 dark:text-violet-300' },
  error: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-300', bg: 'bg-red-500/10', icon: 'text-red-600 dark:text-red-300' },
};

const STATUS_LABEL = { active: 'Active', completed: 'Completed', pending: 'Pending', error: 'Error' };

/**
 * HeaderActivity - the single, sticky status+activity chip in the app header
 * (one per workflow). It replaces both the old static status pill and the
 * bottom upload dock: it reflects whatever the workflow is doing right now
 * (uploading, extracting, reviewing, generating the PDD, complete...) and opens
 * a popover with the full picture (per-file uploads + live run steps).
 */
export default function HeaderActivity({ project }) {
  const { uploads, dismissUpload, runState } = useEUCProjects();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const projectId = project?.id;
  const ups = useMemo(
    () => Object.values(uploads || {})
      .filter((u) => u.projectId === projectId)
      .sort((a, b) => {
        const rank = (s) => (s === 'uploading' || s === 'pending' ? 0 : s === 'error' ? 1 : 2);
        return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
      }),
    [uploads, projectId],
  );

  const activeUploads = ups.filter((u) => u.status === 'uploading' || u.status === 'pending');
  const failedUploads = ups.filter((u) => u.status === 'error');
  const live = runState?.[projectId] || null;
  const liveStatus = live?.status || null;
  const running = liveStatus === 'queued' || liveStatus === 'running' || project?.analysisStatus === 'running';
  const paused = liveStatus === 'paused' || (!live && project?.analysisStatus === 'paused');

  // Derive the headline activity.
  const activity = useMemo(() => {
    if (activeUploads.length) {
      const pct = Math.round(ups.reduce((s, u) => s + (u.pct || 0), 0) / Math.max(1, ups.length));
      return {
        tone: 'upload',
        icon: UploadCloud,
        spin: false,
        pulse: true,
        label: `Uploading ${activeUploads.length} file${activeUploads.length === 1 ? '' : 's'}...`,
        pct,
      };
    }
    if (running) {
      return { tone: 'run', icon: Loader2, spin: true, label: live?.message || 'Analysing...' };
    }
    if (paused) {
      return { tone: 'review', icon: ListChecks, label: 'Awaiting your review' };
    }
    if (failedUploads.length) {
      return { tone: 'error', icon: AlertCircle, label: `${failedUploads.length} upload${failedUploads.length === 1 ? '' : 's'} failed` };
    }
    if (project?.analysisStatus === 'done') {
      return { tone: 'done', icon: CheckCircle2, label: 'Analysis complete' };
    }
    if (project?.analysisStatus === 'error') {
      return { tone: 'error', icon: AlertCircle, label: 'Analysis failed' };
    }
    return { tone: 'status', dotOnly: true, label: STATUS_LABEL[project?.status] || 'Active' };
  }, [activeUploads.length, failedUploads.length, running, paused, ups, live, project?.analysisStatus, project?.status]);

  const t = TONES[activity.tone] || TONES.status;
  const Icon = activity.icon;
  const hasDetail = ups.length > 0 || Boolean(live);

  const recentEvents = useMemo(() => (live?.events || []).slice(-6).reverse(), [live]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        title={hasDetail ? 'Show details' : activity.label}
        className={cn(
          'flex max-w-[260px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
          t.bg, t.text,
          hasDetail ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
        )}
      >
        {activity.dotOnly ? (
          <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', t.dot)} />
        ) : (
          <Icon size={12} className={cn('flex-shrink-0', t.icon, activity.spin && 'animate-spin', activity.pulse && 'animate-pulse')} />
        )}
        <span className="truncate">{activity.label}</span>
        {typeof activity.pct === 'number' && <span className="flex-shrink-0 tabular-nums opacity-80">{activity.pct}%</span>}
        {hasDetail && <ChevronDown size={12} className={cn('flex-shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />}
      </button>

      {open && hasDetail && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card/95 shadow-xl backdrop-blur-md">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-border bg-gradient-to-r from-primary/8 to-transparent px-3.5 py-2.5">
              <span className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg', t.bg)}>
                {activity.dotOnly ? <Activity size={15} className={t.icon} /> : <Icon size={15} className={cn(t.icon, activity.spin && 'animate-spin')} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-foreground">{activity.label}</p>
                {typeof activity.pct === 'number' && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${activity.pct}%` }} />
                  </div>
                )}
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2.5">
              {/* Uploads */}
              {ups.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Files</p>
                  {ups.map((u) => {
                    const failed = u.status === 'error';
                    const done = u.status === 'done';
                    return (
                      <div key={`${u.projectId}:${u.name}`} className="rounded-xl border border-border bg-background px-2.5 py-2">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                            {failed ? <AlertCircle size={12} className="flex-shrink-0 text-destructive" />
                            : done ? <CheckCircle2 size={12} className="flex-shrink-0 text-emerald-600" />
                            : <UploadCloud size={12} className="flex-shrink-0 animate-pulse text-blue-500" />}
                            <span className="truncate font-medium">{u.name}</span>
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">
                            {failed ? 'failed' : done ? 'done' : `${u.pct}%`}
                            {(failed || done) && (
                              <button onClick={() => dismissUpload(u.projectId, u.name)} className="rounded p-0.5 text-muted-foreground/70 hover:bg-secondary hover:text-foreground">
                                <X size={11} />
                              </button>
                            )}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div className={cn('h-full transition-all duration-200', failed ? 'bg-destructive' : done ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${u.pct}%` }} />
                        </div>
                        {(failed || done) && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                            <Cloud size={9} />
                            {u.size > 0 && <span className="ml-auto tabular-nums">{formatSize(u.loaded)} / {formatSize(u.size)}</span>}
                          </div>
                        )}
                        {failed && u.error && <p className="mt-1 text-[10px] text-destructive">{u.error}</p>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Live run */}
              {live && (
                <div className="space-y-1.5">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Analysis</p>
                  <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Sparkles size={12} className="text-primary" /> {live.message || 'Working...'}
                    </p>
                    {recentEvents.length > 0 && (
                      <ul className="mt-1.5 space-y-1 border-l border-border pl-2.5">
                        {recentEvents.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-muted-foreground/50" />
                            <span className="min-w-0 flex-1 truncate">{e.message}</span>
                            <span className="flex-shrink-0 tabular-nums text-muted-foreground/60">{relTime(e.at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      onClick={() => { setOpen(false); navigate(`/projects/${projectId}/workflow`); }}
                      className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open Analysis tab <ArrowRight size={11} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}