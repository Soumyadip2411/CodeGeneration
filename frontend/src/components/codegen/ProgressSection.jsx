/**
 * ProgressSection - real-time progress display for code generation runs.
 *
 * Connects to SSE endpoints:
 *   GET /api/codegen/runs/{runId}/progress   - coarse step/message frames
 *   GET /api/codegen/runs/{runId}/events     - granular agent/tool events
 *
 * Shows:
 *   - Current stage with progress indicator
 *   - Live event log (agent start/end, tool calls)
 *   - Token usage summary (after completion)
 */
import { useEffect, useState, useRef } from 'react';
import {
  Activity, CheckCircle2, XCircle, Loader2, Clock,
  Wrench, Bot, ChevronDown, ChevronUp, MessageSquare, Map, Code2, AlertTriangle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getServiceBaseUrl } from '../../api/serviceClients';
import { listRuns } from '../../api/codegen';

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function EventRow({ event }) {
  const isToolStart = event.type === 'agent.tool.start';
  const isToolEnd = event.type === 'agent.tool.end';
  const isAgentStart = event.type === 'agent.start';
  const isAgentEnd = event.type === 'agent.end';

  const Icon = isToolStart || isToolEnd ? Wrench
    : isAgentStart || isAgentEnd ? Bot
    : Activity;

  const color = event.level === 'error' ? 'text-red-500'
    : isAgentEnd ? 'text-emerald-500'
    : isToolEnd ? 'text-sky-500'
    : 'text-muted-foreground';

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0 text-xs">
      <Icon size={12} className={cn('mt-0.5 flex-shrink-0', color)} />
      <span className={cn('flex-1', color)}>{event.message || event.type}</span>
      {event.data?.ms && (
        <span className="text-muted-foreground/60 flex-shrink-0">{event.data.ms}ms</span>
      )}
    </div>
  );
}

export default function ProgressSection({ workflow, onSwitchTab }) {
  const [progress, setProgress] = useState(null);
  const [events, setEvents] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const eventsEndRef = useRef(null);
  const eventsContainerRef = useRef(null);
  const eventsRef = useRef([]); // Persist events across SSE reconnections

  // Load the latest run - poll every 3s while active to pick up new runs + status changes
  useEffect(() => {
    const load = () => listRuns(workflow.id).then((runs) => {
      if (runs.length > 0) setLatestRun(runs[0]);
    }).catch(() => {});
    load();

    // Poll while the workflow might have an active run
    const wfStatus = workflow.latest_run_status;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(wfStatus);
    if (!isTerminal || !wfStatus) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
  }, [workflow.id, workflow.latest_run_id, workflow.latest_run_status]);

  // SSE: progress stream
  useEffect(() => {
    const runId = latestRun?.id || workflow.latest_run_id;
    if (!runId) return;

    const status = latestRun?.status || workflow.latest_run_status;
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      setProgress({ step: 10, message: status === 'completed' ? 'Completed' : `Run ${status}`, done: true });
      return;
    }

    const baseUrl = getServiceBaseUrl('codegen');
    const source = new EventSource(`${baseUrl}/api/codegen/runs/${runId}/progress`);

    source.onmessage = (e) => {
      try { setProgress(JSON.parse(e.data)); } catch {}
    };
    source.onerror = () => source.close();

    return () => source.close();
  }, [latestRun?.id, workflow.latest_run_id, latestRun?.status, workflow.latest_run_status]);

  // SSE: events stream - events persist in ref so they survive after SSE closes
  useEffect(() => {
    const runId = latestRun?.id || workflow.latest_run_id;
    if (!runId) return;

    const status = latestRun?.status || workflow.latest_run_status;

    // For completed runs: load events from persisted agent_trace
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      if (latestRun?.agent_trace && Array.isArray(latestRun.agent_trace) && latestRun.agent_trace.length > 0) {
        eventsRef.current = latestRun.agent_trace;
        setEvents(latestRun.agent_trace);
      }
      return;
    }

    // Reset events for a new live run
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
  }, [latestRun?.id, workflow.latest_run_id, latestRun?.status, workflow.latest_run_status]);

  // Auto-scroll events - scoped to the container, not the whole page
  useEffect(() => {
    const container = eventsContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [events.length]);

  const runId = latestRun?.id || workflow.latest_run_id;
  const status = latestRun?.status || workflow.latest_run_status;
  const isDone = progress?.done || ['completed', 'failed', 'cancelled'].includes(status);
  const isRunning = status === 'running' || status === 'queued';

  // Determine which stage completed for the HITL next-step card
  const completedStage =
    isDone && status === 'completed'
      ? progress?.payload?.stage || latestRun?.stage || workflow.stage || ''
      : '';

  // Token usage - find the agent.end event or old-format summary with token data
  const agentTrace = latestRun?.agent_trace || [];
  const tokenEntry = agentTrace.find((e) =>
    (e.type === 'agent.end' && (e.data?.total_tokens > 0 || e.data?.prompt_tokens > 0)) ||
    e.total_tokens > 0 ||
    e.prompt_tokens > 0
  ) || {};

  // agent.end stores in e.data; old format stores at top level
  const tokenData = (tokenEntry.type === 'agent.end') ? (tokenEntry.data || {}) : tokenEntry;
  const hasTokens = (tokenData.total_tokens || tokenData.prompt_tokens || 0) > 0;

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Activity className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Runs Yet</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Start a code generation from the Workflow Summary tab to see progress here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Loader2 size={16} className="text-primary animate-spin" />
            ) : isDone && status === 'completed' ? (
              <CheckCircle2 size={16} className="text-emerald-500" />
            ) : isDone ? (
              <XCircle size={16} className="text-red-500" />
            ) : (
              <Clock size={16} className="text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">
              {progress?.message || (isRunning ? 'Running...' : status || 'Pending')}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Step {progress?.step || 0} / 10
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isDone && status === 'completed' ? 'bg-emerald-500'
                : isDone ? 'bg-red-500'
                : 'bg-primary'
            )}
            style={{ width: `${Math.min(100, (progress?.step || 0) * 10)}%` }}
          />
        </div>
      </div>

      {/* Token usage (shown after completion) */}
      {isDone && hasTokens && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-medium text-foreground mb-3">Run Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">Model</p>
              <p className="text-xs font-semibold text-foreground truncate">{tokenData.model || '-'}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">Input Tokens</p>
              <p className="text-xs font-semibold text-foreground">{(tokenData.prompt_tokens || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">Output Tokens</p>
              <p className="text-xs font-semibold text-foreground">{(tokenData.completion_tokens || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">Duration</p>
              <p className="text-xs font-semibold text-foreground">{formatDuration(tokenData.duration_ms || tokenData.ms)}</p>
            </div>
          </div>
        </div>
      )}

      {/* HITL next-step card - shown when a stage completes successfully that needs human review */}
      {isDone && status === 'completed' && (completedStage === 'gap_analysis' || completedStage === 'sdd_generation' || workflow.status === 'waiting_for_answers' || workflow.status === 'questions_generated' || workflow.status === 'plan_generated') && (
        <div className="glass-card p-5 border-l-4 border-amber-500 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 p-2 rounded-lg bg-amber-500/10">
              {completedStage === 'gap_analysis' || workflow.status === 'waiting_for_answers' || workflow.status === 'questions_generated' ? (
                <MessageSquare size={20} className="text-amber-500" />
              ) : workflow.status === 'plan_generated' || completedStage === 'sdd_generation' ? (
                <Map size={20} className="text-purple-500" />
              ) : (
                <AlertTriangle size={20} className="text-amber-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {(completedStage === 'gap_analysis' || workflow.status === 'waiting_for_answers' || workflow.status === 'questions_generated') && (
                <>
                  <h4 className="text-sm font-semibold text-foreground mb-1">
                    Review Questions Ready - Human Input Required
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    The AI has analyzed your design documents and identified gaps that need clarification.
                    Please review the questions, provide answers, then proceed to SDD generation.
                  </p>
                  <button
                    onClick={() => onSwitchTab && onSwitchTab('questions')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
                  >
                    <MessageSquare size={14} />
                    Go to Review Questions
                  </button>
                </>
              )}
              {(workflow.status === 'plan_generated' || completedStage === 'sdd_generation') && (
                <>
                  <h4 className="text-sm font-semibold text-foreground mb-1">
                    SDD Preview Ready - Review and Approve
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    The System Design Document has been generated. Please review it and approve
                    to proceed with code generation.
                  </p>
                  <button
                    onClick={() => onSwitchTab && onSwitchTab('plan')}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-500 text-white hover:bg-purple-600 transition-colors shadow-sm"
                  >
                    <Map size={14} />
                    View SDD Preview
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Code generation complete card */}
      {isDone && status === 'completed' && workflow.status === 'completed' && completedStage !== 'gap_analysis' && completedStage !== 'sdd_generation' && (
        <div className="glass-card p-5 border-l-4 border-emerald-500 bg-emerald-500/5">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 p-2 rounded-lg bg-emerald-500/10">
              <CheckCircle2 size={20} className="text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-foreground mb-1">
                Code Generation Complete
              </h4>
              <p className="text-xs text-muted-foreground mb-3">
                All artifacts have been generated successfully. You can browse the generated
                code in the Code View tab.
              </p>
              <button
                onClick={() => onSwitchTab && onSwitchTab('code')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm"
              >
                <Code2 size={14} />
                View Generated Code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event log */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Activity size={14} />
            Event Log ({events.length} event{events.length === 1 ? '' : 's'})
          </span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {expanded && (
          <div ref={eventsContainerRef} className="px-4 pb-3 max-h-72 overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                {isRunning ? 'Waiting for events...' : 'No events recorded for this run.'}
              </p>
            ) : (
              <>
                {events.map((ev, i) => <EventRow key={ev.seq || i} event={ev} />)}
                <div ref={eventsEndRef} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}