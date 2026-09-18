/**
 * ArtifactsCenterPage - cross-workflow view of all runs + download actions.
 *
 * Shows all workflows with their completed runs, artifact file counts,
 * and per-run download/export options.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Loader2, FolderCode, Code2, Calendar, User,
  ChevronDown, ChevronRight, Package,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { listWorkflows, listRuns, exportZip } from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RunRow({ run, onExport, exporting }) {
  const hasArtifacts = run.artifact_file_count > 0;
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary flex-shrink-0">
        <Package size={14} className={hasArtifacts ? 'text-primary' : 'text-muted-foreground'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-foreground truncate">{run.id.slice(0, 8)}</span>
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
            run.status === 'completed' ? 'bg-emerald-500/20 text-emerald-500' :
            run.status === 'failed' ? 'bg-red-500/20 text-red-500' :
            'bg-secondary text-muted-foreground'
          )}>
            {run.status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><User size={9} />{run.triggered_by || '-'}</span>
          <span className="flex items-center gap-1"><Calendar size={9} />{formatDate(run.created_at)}</span>
          {hasArtifacts && <span>{run.artifact_file_count} files ({formatBytes(run.artifact_total_bytes)})</span>}
        </div>
      </div>
      {hasArtifacts && (
        <button
          onClick={() => onExport(run.id)}
          disabled={exporting === run.id}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            exporting === run.id && 'opacity-50 cursor-wait'
          )}
        >
          {exporting === run.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          ZIP
        </button>
      )}
    </div>
  );
}

function WorkflowSection({ workflow, runs, onExport, exporting }) {
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();
  const completedRuns = runs.filter((r) => r.status === 'completed' && r.artifact_file_count > 0);
  const allRuns = runs;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <Code2 size={16} className="text-primary" />
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{workflow.name}</p>
          <p className="text-[10px] text-muted-foreground">{workflow.primary_usage || 'No usage'} • {allRuns.length} run{allRuns.length === 1 ? '' : 's'} • {completedRuns.length} with artifacts</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/codegen/workflows/${workflow.id}`); }}
          className="text-xs text-primary hover:underline flex-shrink-0"
        >
          Open
        </button>
      </button>
      {expanded && allRuns.length > 0 && (
        <div className="border-t border-border/50">
          {allRuns.map((run) => (
            <RunRow key={run.id} run={run} onExport={onExport} exporting={exporting} />
          ))}
        </div>
      )}
      {expanded && allRuns.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border/50">No runs yet.</p>
      )}
    </div>
  );
}

export default function ArtifactsCenterPage() {
  const [workflows, setWorkflows] = useState([]);
  const [runsByWorkflow, setRunsByWorkflow] = useState({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(null);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const wfs = await listWorkflows();
        setWorkflows(wfs);
        // Load runs for each workflow
        const runsMap = {};
        await Promise.all(wfs.map(async (wf) => {
          try {
            const runs = await listRuns(wf.id);
            runsMap[wf.id] = runs;
          } catch {
            runsMap[wf.id] = [];
          }
        }));
        setRunsByWorkflow(runsMap);
      } catch (err) {
        console.error('Failed to load artifacts:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleExport = async (runId) => {
    setExporting(runId);
    try {
      const blob = await exportZip(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codegen-${runId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ZIP downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const totalRuns = Object.values(runsByWorkflow).flat().length;
  const totalWithArtifacts = Object.values(runsByWorkflow).flat().filter((r) => r.artifact_file_count > 0).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
            <Download size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Artifacts Center</h2>
            <p className="text-xs text-muted-foreground">
              {workflows.length} workflow{workflows.length === 1 ? '' : 's'} • {totalRuns} run{totalRuns === 1 ? '' : 's'} • {totalWithArtifacts} with downloadable artifacts
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <FolderCode size={40} className="text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">No Workflows</p>
            <p className="text-sm text-muted-foreground">Create a workflow and run code generation to see artifacts here.</p>
          </div>
        ) : (
          workflows.map((wf) => (
            <WorkflowSection
              key={wf.id}
              workflow={wf}
              runs={runsByWorkflow[wf.id] || []}
              onExport={handleExport}
              exporting={exporting}
            />
          ))
        )}
      </div>
    </div>
  );
}
