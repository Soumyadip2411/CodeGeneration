import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Map,
  Activity,
  Code2,
  Loader2,
  Upload,
  Lock,
  FileUp,
  GitBranch,
  Clock,
  Calendar,
  X,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  getWorkflow, WORKFLOW_STATUS_META, uploadFile, listFiles, startGeneration, deleteFile, cancelRun,
} from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';
import ProgressSection from '../../components/codegen/ProgressSection';
import CodeViewSection from '../../components/codegen/CodeViewSection';
import CodegenMetaBar from '../../components/codegen/CodegenMetaBar';

const TABS = [
  { id: 'summary', label: 'Workflow Summary', icon: FileText },
  { id: 'questions', label: 'Review Questions', icon: MessageSquare },
  { id: 'plan', label: 'Intermediate Plan', icon: Map },
  { id: 'progress', label: 'Progress', icon: Activity },
  { id: 'code', label: 'Code View', icon: Code2 },
];

function PlaceholderSection({ title, icon: Icon, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-2xl bg-secondary mb-4">
        <Icon className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-md">{description}</p>
      <span className="mt-4 px-3 py-1 text-xs rounded-full bg-secondary text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> Coming in next phase
      </span>
    </div>
  );
}

function WorkflowSummarySection({ workflow, onRefresh }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    listFiles(workflow.id).then(setFiles).catch(() => {});
  }, [workflow.id, workflow.file_count]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadFile(workflow.id, file);
      const updated = await listFiles(workflow.id);
      setFiles(updated);
      if (onRefresh) onRefresh();
      toast.success(`${file.name} uploaded successfully`);
    } catch (err) {
      console.error('Upload failed:', err);
      toast.error(`Upload failed: ${err?.response?.data?.error?.message || err.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const hasRun = workflow.run_count > 0;
  const isRunning = workflow.status === 'generating';

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".txt,.md"
        onChange={handleUpload}
      />
      <div
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed border-border rounded-xl p-8 text-center transition-colors cursor-pointer',
          uploading ? 'opacity-50 cursor-wait' : 'hover:border-primary/50'
        )}
      >
        {uploading ? (
          <Loader2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 animate-spin" />
        ) : (
          <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        )}
        <p className="text-sm font-medium text-foreground">
          {uploading ? 'Uploading...' : 'Upload PDD or Design Files'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Click to browse. Supported formats: .txt, .md
        </p>
      </div>

      {/* Files list - card per file with delete */}
      <div className="glass-card p-4">
        <h4 className="text-sm font-medium text-foreground mb-3">Uploaded Files</h4>
        {files.length > 0 ? (
          <div className="space-y-2">
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                <FileText size={14} className="text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{f.filename}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {f.size_bytes > 1024 * 1024
                      ? `${(f.size_bytes / (1024 * 1024)).toFixed(1)} MB`
                      : `${Math.ceil(f.size_bytes / 1024)} KB`}
                    {f.uploaded_by && ` · ${f.uploaded_by}`}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await deleteFile(workflow.id, f.id);
                      setFiles((prev) => prev.filter((x) => x.id !== f.id));
                      if (onRefresh) onRefresh();
                      toast.success(`${f.filename} deleted`);
                    } catch (err) {
                      toast.error('Delete failed');
                    }
                  }}
                  disabled={isRunning}
                  title={isRunning ? 'Cannot delete while generation is running' : 'Delete file'}
                  className={cn(
                    'p-1 rounded transition-colors',
                    isRunning
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                  )}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No files uploaded yet. Upload your files to get started.</p>
        )}
      </div>
    </div>
  );
}

export default function WorkflowDetailPage() {
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [starting, setStarting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const wf = await getWorkflow(workflowId);
        setWorkflow(wf);
      } catch (e) {
        console.error('Failed to load workflow:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [workflowId]);

  // Poll workflow status while a run is active - keeps status badge and footer in sync
  useEffect(() => {
    if (!workflow) return;
    const isActive = workflow.status === 'generating';
    if (!isActive) return;
    const interval = setInterval(() => {
      getWorkflow(workflowId).then(setWorkflow).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [workflowId, workflow?.status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Workflow not found.</p>
        <button onClick={() => navigate('/codegen/workflows')} className="mt-3 text-primary text-sm hover:underline">
          &larr; Back to Dashboard
        </button>
      </div>
    );
  }

  const statusMeta = WORKFLOW_STATUS_META[workflow.status] || WORKFLOW_STATUS_META.created;
  const isRunning = workflow.status === 'generating';
  const isCompleted = workflow.status === 'completed';
  const hasRun = workflow.run_count > 0;
  const isSummaryTab = activeTab === 'summary';

  const refreshWorkflow = () => getWorkflow(workflowId).then(setWorkflow);

  const handleStartGeneration = async () => {
    setStarting(true);
    setActiveTab('progress');
    try {
      await startGeneration(workflow.id);
      refreshWorkflow();
      toast.success('Code generation started');
    } catch (err) {
      toast.error(`Failed to start: ${err?.response?.data?.error?.message || err.message || 'Unknown error'}`);
      setActiveTab('summary');
    } finally {
      setStarting(false);
    }
  };

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top stat boxes - only on summary tab */}
      {isSummaryTab && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-border bg-card px-8 py-4">
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 bg-amber-50')}>
                <FileUp size={14} className="text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Input Files</p>
                <p className="text-sm font-semibold text-foreground">
                  {workflow.file_count} file{workflow.file_count === 1 ? '' : 's'}
                </p>
                {workflow.file_count === 0 && <p className="text-[10px] text-muted-foreground/80">No files uploaded yet</p>}
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 bg-blue-50')}>
                <GitBranch size={14} className="text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Workflow Runs</p>
                <p className="text-sm font-semibold text-foreground">{workflow.run_count}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 bg-secondary')}>
                <Clock size={14} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Generation</p>
                <p className="text-sm font-semibold text-foreground">{statusMeta.label}</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 bg-secondary')}>
                <Calendar size={14} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Updated</p>
                <p className="text-sm font-semibold text-foreground truncate">{formatDate(workflow.updated_at)}</p>
                <p className="text-[10px] text-muted-foreground/80 truncate">Created {formatDate(workflow.created_at)}</p>
              </div>
            </div>
          </div>

          {/* Workflow metadata - collapsible edit strip */}
          <div className="px-8 py-3 border-b border-border bg-card">
            <CodegenMetaBar workflow={workflow} onUpdate={refreshWorkflow} />
          </div>
        </>
      )}

      <div className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/codegen/workflows')}
            className="mt-1 p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-foreground truncate">{workflow.name}</h1>
              <span className={cn('text-xs px-2 py-0.5 rounded-full text-white', statusMeta.color)}>
                {statusMeta.label}
              </span>
              {workflow.primary_usage && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  {workflow.primary_usage}
                </span>
              )}
            </div>
            {workflow.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{workflow.description}</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
                  'border-b-2 transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'summary' && <WorkflowSummarySection workflow={workflow} onRefresh={refreshWorkflow} />}
          {activeTab === 'questions' && (
            <PlaceholderSection
              title="Review Questions"
              icon={MessageSquare}
              description="The agent will generate clarification questions after reviewing your PDD. You can answer, skip, or accept assumptions."
            />
          )}
          {activeTab === 'plan' && (
            <PlaceholderSection
              title="Intermediate Plan"
              icon={Map}
              description="Before generating code, the agent will produce a high-level and low-level design plan for your review and approval."
            />
          )}
          {activeTab === 'progress' && (
            <ProgressSection workflow={workflow} onSwitchTab={setActiveTab} />
          )}
          {activeTab === 'code' && (
            <CodeViewSection workflow={workflow} />
          )}
        </motion.div>
      </div>

      {/* Fixed footer action bar - context-aware per tab */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 border-t border-border bg-card px-8 py-3">
        <span className="text-xs text-muted-foreground">
          {workflow.name} · {statusMeta.label}
        </span>
        <div className="flex items-center gap-3">
          {/* Summary / Questions / Plan tabs: Start or Re-run */}
          {(activeTab === 'summary' || activeTab === 'questions' || activeTab === 'plan') && (
            isRunning ? (
              <button
                onClick={() => setActiveTab('progress')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-secondary text-muted-foreground hover:bg-secondary/80 transition-colors"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                View Progress
              </button>
            ) : (
              <button
                onClick={handleStartGeneration}
                disabled={workflow.file_count === 0 || starting}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm',
                  workflow.file_count > 0 && !starting
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-primary/40 text-primary-foreground/60 cursor-not-allowed'
                )}
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                {hasRun ? 'Re-run Code Generation' : 'Start Code Generation'}
              </button>
            )
          )}

          {/* Progress tab: Stop (if running) or View Code (if completed) */}
          {activeTab === 'progress' && (
            isRunning ? (
              <button
                onClick={async () => {
                  try {
                    await cancelRun(workflow.latest_run_id);
                    toast.success('Run cancellation requested');
                    // Refresh immediately + again after a short delay to catch Cosmos write
                    refreshWorkflow();
                    setTimeout(refreshWorkflow, 2000);
                  } catch {
                    toast.error('Cancel failed');
                  }
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                <X className="w-4 h-4" />
                Stop Run
              </button>
            ) : isCompleted ? (
              <button
                onClick={() => setActiveTab('code')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Code2 className="w-4 h-4" />
                View Generated Code
              </button>
            ) : (
              <button
                onClick={handleStartGeneration}
                disabled={workflow.file_count === 0 || starting}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm',
                  workflow.file_count > 0 && !starting
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-primary/40 text-primary-foreground/60 cursor-not-allowed'
                )}
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                {hasRun ? 'Re-run Code Generation' : 'Start Code Generation'}
              </button>
            )
          )}

          {/* Code tab: Re-run */}
          {activeTab === 'code' && (
            <button
              onClick={handleStartGeneration}
              disabled={isRunning || starting}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm',
                !isRunning && !starting
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-primary/40 text-primary-foreground/60 cursor-not-allowed'
              )}
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
              Re-run Code Generation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
