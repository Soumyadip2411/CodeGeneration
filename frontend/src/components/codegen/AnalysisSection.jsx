/**
 * AnalysisSection - dedicated Analysis tab UI that replaces Progress for gap_analysis and sdd_generation stages.
 *
 * Shows:
 *  - Stage-specific header (Gap Analysis or SDD Generation)
 *  - Breakdown of analysis steps with live status icons
 *  - Dynamic progress bar (0-100%) driven by SSE progress frames
 *  - Live SSE event stream with per-step details
 *  - Green checkmark indicator when analysis completes
 *  - CTA button to advance to the next HITL step when done
 */
import { useEffect, useState, useRef } from 'react';
import {
  Loader2, CheckCircle2, XCircle, Clock, Bot, FileSearch, FileText,
  Sparkles, ArrowRight, Activity, AlertTriangle, FolderOpen, Upload, Database, Shield,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getServiceBaseUrl } from '../../api/serviceClients';
import { listRuns } from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';

// Define the analysis-step pipelines per stage
const GAP_ANALYSIS_STEPS = [
  { id: 'init', label: 'Initializing analysis workspace', icon: FolderOpen, detail: 'Preparing workspace and downloading PDD files' },
  { id: 'download', label: 'Loading PDD documents', icon: Upload, detail: 'Retrieving uploaded input files from storage' },
  { id: 'parsing', label: 'Parsing PDD content', icon: FileSearch, detail: 'Reading and understanding document structure' },
  { id: 'analyzing', label: 'AI gap analysis in progress', icon: Bot, detail: 'Identifying ambiguities, missing requirements, risks' },
  { id: 'categorizing', label: 'Categorizing and scoring questions', icon: Shield, detail: 'Grouping by business rules, I/O, security; applying risk scores' },
  { id: 'suggesting', label: 'Generating suggested answers', icon: Sparkles, detail: 'Drafting AI-proposed answers per industry standards' },
  { id: 'complete', label: 'Analysis complete', icon: CheckCircle2, detail: 'Questions ready for human review' },
];

const SDD_ANALYSIS_STEPS = [
  { id: 'init', label: 'Initializing SDD workspace', icon: FolderOpen, detail: 'Preparing workspace and loading Q&A context' },
  { id: 'download', label: 'Loading PDD and resolved Q&A', icon: Upload, detail: 'Retrieving input files and review answers' },
  { id: 'reviewing', label: 'Reviewing requirements', icon: FileSearch, detail: 'Synthesizing PDD content with gap analysis answers' },
  { id: 'architecture', label: 'Designing system architecture', icon: Database, detail: 'Drafting modules, data models, component boundaries' },
  { id: 'writing', label: 'Generating SDD sections', icon: Bot, detail: 'Writing architecture, APIs, security, operations sections' },
  { id: 'complete', label: 'SDD generation complete', icon: CheckCircle2, detail: 'SDD document ready for human review and approval' },
];

// Map step names + progress integer range to pipeline step indexes
function getStepIndex(progressStep, stage, message) {
  if (!stage) return 0;
  const steps = stage === 'gap_analysis' ? GAP_ANALYSIS_STEPS : SDD_ANALYSIS_STEPS;

  if (progressStep >= 10) return steps.length - 1;
  if (progressStep >= 8) return steps.length - 2;
  if (progressStep >= 7) return steps.length - 3;
  if (progressStep >= 5) return steps.length - 4;
  if (progressStep >= 4) return steps.length - 5;
  if (progressStep >= 3) return Math.max(0, steps.length - 6);
  if (progressStep >= 2) return Math.max(0, steps.length - 7);
  if (progressStep >= 1) return 0;

  const m = (message || '').toLowerCase();
  if (m.includes('queued')) return 0;
  return 0;
}

export default function AnalysisSection({ workflow, onSwitchTab, onCompletionStage }) {
  const [latestRun, setLatestRun] = useState(null);
  const [progress, setProgress] = useState(null);
  const [events, setEvents] = useState([]);
  const eventsRef = useRef([]);
  const eventsEndRef = useRef(null);
  const toast = useToast();
  const transitionedRef = useRef(false);

  // Load the latest run
  useEffect(() => {
    const load = () =>
      listRuns(workflow.id)
        .then((runs) => {
          if (runs.length > 0) setLatestRun(runs[0]);
        })
        .catch(() => {});
    load();
    const wfStatus = workflow.latest_run_status;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(wfStatus);
    if (!isTerminal || !wfStatus) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
  }, [workflow.id, workflow.latest_run_id, workflow.latest_run_status]);

  const runId = latestRun?.id || workflow.latest_run_id;
  const runStatus = latestRun?.status || workflow.latest_run_status;
  const runStage =
    latestRun?.stage ||
    progress?.payload?.stage ||
    workflow.stage ||
    ((workflow.status === 'generating' || workflow.status === 'waiting_for_answers' || workflow.status === 'questions_generated')
      ? 'gap_analysis'
      : workflow.status === 'plan_generated'
        ? 'sdd_generation'
        : '');

  const isAnalysisStage = runStage === 'gap_analysis' || runStage === 'sdd_generation' || !runStage;
  const analysisSteps = runStage === 'sdd_generation' ? SDD_ANALYSIS_STEPS : GAP_ANALYSIS_STEPS;
  const isDone = progress?.done || ['completed', 'failed', 'cancelled'].includes(runStatus);
  const isFailed = runStatus === 'failed';
  const isCancelled = runStatus === 'cancelled';
  const isSuccess = isDone && !isFailed && !isCancelled;

  // SSE progress stream
  useEffect(() => {
    if (!runId) return;
    if (['completed', 'failed', 'cancelled'].includes(runStatus)) {
      setProgress({
        step: isSuccess ? 10 : 99,
        message: isSuccess ? 'Completed' : `Run ${runStatus}`,
        done: true,
      });
      return;
    }
    const baseUrl = getServiceBaseUrl('codegen');
    const source = new EventSource(`${baseUrl}/api/codegen/runs/${runId}/progress`);
    source.onmessage = (e) => {
      try { setProgress(JSON.parse(e.data)); } catch {}
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [runId, runStatus, isSuccess]);

  // SSE events stream
  useEffect(() => {
    if (!runId) return;
    if (['completed', 'failed', 'cancelled'].includes(runStatus)) {
      if (latestRun?.agent_trace && Array.isArray(latestRun.agent_trace) && latestRun.agent_trace.length > 0) {
        eventsRef.current = latestRun.agent_trace;
        setEvents(latestRun.agent_trace);
      }
      return;
    }
    eventsRef.current = [];
    setEvents([]);
    const baseUrl = getServiceBaseUrl('codegen');
    const source = new EventSource(`${baseUrl}/api/codegen/runs/${runId}/events?after=0`);
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        eventsRef.current = [...eventsRef.current, data];
        setEvents(eventsRef.current);
      } catch {}
    };
    source.addEventListener('done', () => source.close());
    source.onerror = () => source.close();
    return () => source.close();
  }, [runId, runStatus, latestRun?.agent_trace]);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  // Auto-advance to next HITL tab when analysis completes successfully
  useEffect(() => {
    if (!isSuccess || transitionedRef.current) return;
    // Give the green completion UI a brief moment to be seen
    const t = setTimeout(() => {
      transitionedRef.current = true;
      if (onCompletionStage) onCompletionStage(runStage);
      else if (runStage === 'gap_analysis' && onSwitchTab) {
        toast.info('Analysis complete - questions ready for review');
        onSwitchTab('questions');
      } else if (runStage === 'sdd_generation' && onSwitchTab) {
        toast.success('SDD generated - ready for review');
        onSwitchTab('plan');
      }
    }, 2200);
    return () => clearTimeout(t);
  }, [isSuccess, runStage, onSwitchTab, onCompletionStage, toast]);

  const currentStepIndex = getStepIndex(progress?.step || 0, runStage, progress?.message);
  const progressPct = isSuccess ? 100 : isFailed ? 99 : Math.min(99, (progress?.step || 0) * 10);
  const isGap = runStage !== 'sdd_generation';
  const stageTitle = isGap ? 'Gap Analysis' : 'SDD Generation';
  const StageIcon = isGap ? FileSearch : FileText;
  const stageAccent = isGap ? 'amber' : 'purple';

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-5 rounded-2xl bg-secondary mb-5">
          <Activity className="w-12 h-12 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">No Analysis Running</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-5">
          Click <strong>Generate SDD</strong> to begin PDD analysis.
        </p>
        {onSwitchTab && (
          <button
            onClick={() => onSwitchTab('summary')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            Go to Summary
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stage header */}
      <div
        className={cn(
          'glass-card p-5 rounded-xl border-l-4',
          stageAccent === 'amber' ? 'border-amber-500' : 'border-purple-500',
          isSuccess && stageAccent === 'amber' && 'ring-1 ring-amber-500/40',
          isSuccess && stageAccent === 'purple' && 'ring-1 ring-purple-500/40'
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0',
              stageAccent === 'amber' ? 'bg-amber-500/10' : 'bg-purple-500/10'
            )}
          >
            {isSuccess ? (
              <CheckCircle2
                size={24}
                className={cn(stageAccent === 'amber' ? 'text-emerald-500' : 'text-emerald-500')}
              />
            ) : isFailed ? (
              <XCircle size={24} className="text-red-500" />
            ) : isCancelled ? (
              <Clock size={24} className="text-orange-500" />
            ) : (
              <StageIcon
                size={24}
                className={cn(
                  stageAccent === 'amber' ? 'text-amber-500' : 'text-purple-500',
                  'animate-pulse'
                )}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-base font-bold text-foreground">{stageTitle}</h2>
              {isSuccess && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 font-semibold uppercase tracking-wide">
                  <CheckCircle2 size={10} /> Complete
                </span>
              )}
              {isFailed && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/30 font-semibold uppercase tracking-wide">
                  <XCircle size={10} /> Failed
                </span>
              )}
              {!isDone && !isFailed && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-500 border border-sky-500/30 font-semibold uppercase tracking-wide animate-pulse">
                  <Loader2 size={10} className="animate-spin" /> In Progress
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {isSuccess
                ? isGap
                  ? 'All gaps have been identified and scored. Questions now need your review.'
                  : 'SDD draft is ready for your review and approval.'
                : isFailed
                  ? 'Analysis failed - check Progress tab for error details and retry.'
                  : isGap
                    ? 'AI is analyzing your PDD for ambiguous or missing requirements…'
                    : 'AI is drafting the SDD from the PDD and resolved Q&A context…'}
            </p>
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground">
                  {progress?.message || (isSuccess ? 'Completed' : 'Processing…')}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{progressPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    isSuccess
                      ? 'bg-emerald-500'
                      : isFailed
                        ? 'bg-red-500'
                        : stageAccent === 'amber'
                          ? 'bg-amber-500'
                          : 'bg-purple-500'
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Step list */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity size={14} className="text-muted-foreground" />
          Analysis Steps
        </h3>
        <ol className="relative border-l border-border ml-2">
          {analysisSteps.map((step, idx) => {
            const StepIcon = step.icon;
            const isCurrent = !isDone && !isFailed && idx === currentStepIndex;
            const isPast = idx < currentStepIndex || isSuccess;
            const stepStatus = isFailed && idx === analysisSteps.length - 1
              ? 'failed'
              : isPast || (isSuccess && idx === analysisSteps.length - 1)
                ? 'done'
                : isCurrent
                  ? 'current'
                  : 'pending';

            return (
              <li key={step.id} className="mb-3 ml-6 last:mb-0">
                <span
                  className={cn(
                    'absolute -left-[9px] flex items-center justify-center w-4.5 h-4.5 rounded-full border-2 transition-colors',
                    stepStatus === 'done'
                      ? 'bg-emerald-500 border-emerald-500'
                      : stepStatus === 'current'
                        ? `bg-white dark:bg-background border-${stageAccent}-500 animate-pulse`
                        : stepStatus === 'failed'
                          ? 'bg-red-500 border-red-500'
                          : 'bg-background border-border'
                  )}
                  style={{ width: '18px', height: '18px' }}
                >
                  {stepStatus === 'done' ? (
                    <CheckCircle2 size={10} className="text-white" />
                  ) : stepStatus === 'failed' ? (
                    <XCircle size={10} className="text-white" />
                  ) : stepStatus === 'current' ? (
                    <Loader2 size={10} className={cn(stageAccent === 'amber' ? 'text-amber-500' : 'text-purple-500', 'animate-spin')} />
                  ) : (
                    <span className={cn('w-1.5 h-1.5 rounded-full bg-border')} />
                  )}
                </span>
                <div className="flex items-start gap-3">
                  <StepIcon
                    size={14}
                    className={cn(
                      'mt-0.5 flex-shrink-0',
                      stepStatus === 'done'
                        ? 'text-emerald-500'
                        : stepStatus === 'current'
                          ? stageAccent === 'amber' ? 'text-amber-500' : 'text-purple-500'
                          : stepStatus === 'failed'
                            ? 'text-red-500'
                            : 'text-muted-foreground/60'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-xs font-semibold leading-tight',
                        stepStatus === 'done'
                          ? 'text-foreground'
                          : stepStatus === 'current'
                            ? 'text-foreground'
                            : stepStatus === 'failed'
                              ? 'text-red-500'
                              : 'text-muted-foreground/80'
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">
                      {step.detail}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Live event log */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Bot size={14} className="text-muted-foreground" />
            Live Agent Events
          </h3>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {events.length} event{events.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="px-4 py-3 max-h-64 overflow-y-auto text-xs">
          {events.length === 0 ? (
            <p className="text-muted-foreground/70 py-2 text-center">
              {isDone ? 'No events recorded.' : 'Waiting for agent output…'}
            </p>
          ) : (
            events.map((ev, i) => {
              const isErr = ev.level === 'error';
              const isWarn = ev.level === 'warn' || ev.level === 'warning';
              const isToolStart = ev.type === 'agent.tool.start';
              const isToolEnd = ev.type === 'agent.tool.end';
              const isAgentEnd = ev.type === 'agent.end';
              const iconC = isErr ? 'text-red-500'
                : isWarn ? 'text-amber-500'
                  : isAgentEnd ? 'text-emerald-500'
                    : isToolEnd ? 'text-sky-500'
                      : isToolStart ? 'text-sky-400'
                        : 'text-muted-foreground';
              return (
                <div key={ev.seq || i} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
                  <div className={cn('mt-0.5', iconC)}>
                    {isErr ? <AlertTriangle size={11} /> : isToolStart || isToolEnd ? <Database size={11} /> : <Bot size={11} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={cn(isErr ? 'text-red-500' : 'text-foreground/90')}>
                      {ev.message || ev.type}
                    </span>
                    {ev.data?.ms && (
                      <span className="text-[10px] text-muted-foreground/60 ml-2 tabular-nums">
                        {ev.data.ms}ms
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={eventsEndRef} />
        </div>
      </div>

      {/* Completion CTA - visible for ~2s after success before auto-advance */}
      {isSuccess && (
        <div className="glass-card p-5 border-l-4 border-emerald-500 bg-emerald-500/5">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle2 size={20} className="text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-foreground mb-1">
                {isGap ? 'Gap Analysis Complete' : 'SDD Generation Complete'}
              </h4>
              <p className="text-xs text-muted-foreground mb-3">
                {isGap
                  ? 'Moving you to the Review Questions tab to answer gaps…'
                  : 'Moving you to the SDD Preview tab to review and approve…'}
              </p>
              <button
                onClick={() => {
                  if (runStage === 'gap_analysis' && onSwitchTab) onSwitchTab('questions');
                  if (runStage === 'sdd_generation' && onSwitchTab) onSwitchTab('plan');
                }}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-colors',
                  isGap ? 'bg-amber-500 hover:bg-amber-600' : 'bg-purple-500 hover:bg-purple-600'
                )}
              >
                {isGap ? 'Review Questions Now' : 'Review SDD Now'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
