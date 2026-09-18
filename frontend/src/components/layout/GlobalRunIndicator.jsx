import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, X, ChevronRight } from 'lucide-react';
import { useEUCProjects } from '../../contexts/EUCProjectContext';

/* Map backend step -> 6-stage label -> overall progress %. */
const STAGE_LABELS = [
  'Document Extraction',
  'Dependency Analysis',
  'EUC Risk Assessment',
  'Lineage Tracing',
  'POD Generation',
  'Review & Finalisation',
];

function mapBackendStep(step) {
  if (step === null) return 0;
  if (step <= 1) return 0;
  if (step <= 7) return 3;
  if (step <= 8) return 1;
  if (step <= 9) return 4;
  return 5;
}

function progressFor(live) {
  if (!live) return 0;
  if (live.status === 'completed' || live.done) return 100;
  if (live.status === 'failed') return 100;
  const idx = mapBackendStep(live.step);
  return Math.round(((idx + 0.5) / STAGE_LABELS.length) * 100);
}

/**
 * Floating, app-wide indicator for background analysis runs. Because the run
 * engine lives in EUCProjectContext, progress keeps streaming no matter where
 * the user navigates - this surfaces it everywhere except the project's own
 * Workflow tab (which renders its own detailed popup).
 */
export default function GlobalRunIndicator() {
  const { runState, projects, dismissWorkflow } = useEUCProjects();
  const navigate = useNavigate();
  const location = useLocation();

  const entries = Object.entries(runState || {}).filter(([projectId, live]) => {
    if (!live) return false;
    // Hide the chip while the user is on that project's Workflow tab.
    return location.pathname !== `/projects/${projectId}/workflow`;
  });

  if (!entries.length) return null;

  return (
    <div className="fixed right-5 top-14 z-40 flex flex-col gap-2.5" style={{ width: 320 }}>
      <AnimatePresence>
        {entries.map(([projectId, live]) => {
          const project = projects.find((p) => p.id === projectId);
          const name = live.name || project?.name || 'Workflow Run';
          const pct = progressFor(live);
          const isRunning = !live.done && (live.status === 'queued' || live.status === 'running');
          const isDone = live.status === 'completed';
          const isFailed = live.status === 'failed';
          const isPaused = live.status === 'paused';
          const stageLabel = isDone ? 'Completed'
            : isFailed ? (live.error || 'Failed')
            : isPaused ? 'Paused for review'
            : (live.message || STAGE_LABELS[mapBackendStep(live.step)]);

          const accent = isFailed ? '#ef4444' : isDone ? '#10b981' : '#FFE600';

          return (
            <motion.div
              key={projectId}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              className="rounded-xl overflow-hidden shadow-2xl cursor-pointer"
              style={{ background: '#1a1f2e' }}
              onClick={() => navigate(`/projects/${projectId}/${isDone || isPaused ? 'results' : 'workflow'}`)}
            >
              {/* Top progress bar */}
              <div style={{ height: 3, background: '#2d3348' }}>
                <motion.div
                  style={{ height: '100%', background: accent }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>

              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <div
                  style={{ background: `${accent}1f`, borderRadius: 8 }}
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center"
                >
                  {isRunning && <Loader2 size={13} style={{ color: accent }} className="animate-spin" />}
                  {isDone && <CheckCircle2 size={13} style={{ color: accent }} />}
                  {isFailed && <AlertCircle size={13} style={{ color: accent }} />}
                  {isPaused && <ChevronRight size={13} style={{ color: accent }} />}
                </div>

                <div className="min-w-0 flex-1">
                  <p style={{ color: '#ffffff', fontSize: 12, fontWeight: 600 }} className="truncate">
                    {name}
                  </p>
                  <p style={{ color: '#9ca3af', fontSize: 11 }} className="truncate">
                    {stageLabel}
                  </p>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  {!isRunning && (
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissWorkflow(projectId); }}
                      style={{ color: '#9ca3af' }}
                      className="rounded p-1 hover:bg-white/10 transition-colors"
                      aria-label="Dismiss"
                    >
                      <X size={13} />
                    </button>
                  )}
                  {isRunning && (
                    <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>{pct}%</span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}