import React, { useEffect, useState, useMemo } from 'react';
import { getQuestions, submitAnswers, startGeneration, startGeneration as _startGen } from '../../api/codegen';
import {
  Loader2, CheckCircle, AlertTriangle, Lock, Sparkles, Shield,
  FileInput, Briefcase, HelpCircle, CheckCircle2, XCircle, ArrowRight,
  ChevronDown, ChevronUp, Copy, Wand2, Gauge,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

// Category metadata for grouping
const CATEGORY_GROUPS = [
  {
    key: 'business_rules',
    label: 'Business Rules',
    description: 'Decision logic, workflow rules, domain requirements, SLAs',
    icon: Briefcase,
    accent: 'indigo',
    border: 'border-indigo-500',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-500',
  },
  {
    key: 'inputs_outputs',
    label: 'Inputs & Outputs',
    description: 'Data formats, schemas, APIs, validations, integrations, transformations',
    icon: FileInput,
    accent: 'sky',
    border: 'border-sky-500',
    bg: 'bg-sky-500/10',
    text: 'text-sky-500',
  },
  {
    key: 'security',
    label: 'Security Requirements',
    description: 'Authentication, PII, authorization, encryption, audit, RBAC',
    icon: Shield,
    accent: 'rose',
    border: 'border-rose-500',
    bg: 'bg-rose-500/10',
    text: 'text-rose-500',
  },
  {
    key: 'other',
    label: 'Other',
    description: 'Additional questions that do not fit the categories above',
    icon: HelpCircle,
    accent: 'slate',
    border: 'border-slate-500',
    bg: 'bg-slate-500/10',
    text: 'text-slate-500',
  },
  // Catch-alls for any category enum we want to fold into the three primary buckets
  { key: 'validations', label: 'Validations', foldInto: 'inputs_outputs' },
  { key: 'integrations', label: 'Integrations', foldInto: 'inputs_outputs' },
];

function resolveCategory(rawCat) {
  const found = CATEGORY_GROUPS.find((g) => g.key === rawCat);
  if (!found) return 'other';
  return found.foldInto || found.key;
}

function priorityMeta(p) {
  if (p === 'critical') {
    return { label: 'Critical', className: 'bg-red-500/10 text-red-600 border-red-500/30', dot: 'bg-red-500' };
  }
  if (p === 'optional') {
    return { label: 'Optional', className: 'bg-slate-500/10 text-slate-600 border-slate-500/30', dot: 'bg-slate-400' };
  }
  return { label: 'Suggested', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30', dot: 'bg-amber-500' };
}

function ConfidenceBar({ value, label }) {
  const color = value >= 80 ? 'text-emerald-500 bg-emerald-500'
    : value >= 50 ? 'text-amber-500 bg-amber-500'
      : 'text-rose-500 bg-rose-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <Gauge size={12} className={color.split(' ')[0]} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={cn('text-[10px] font-bold tabular-nums', color.split(' ')[0])}>{value}%</span>
        </div>
        <div className="w-full h-1 rounded-full bg-secondary overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', color.split(' ')[1])} style={{ width: `${value}%` }} />
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ q, onAnswer, onUseSuggestion, answers, riskThreshold }) {
  const [open, setOpen] = useState(!q.is_resolved);
  const pm = priorityMeta(q.priority);
  const isCritical = q.priority === 'critical' || (q.risk_score || 0) >= (riskThreshold || 70);
  const resolved = q.is_resolved || (answers[q.id] && answers[q.id].trim().length > 0);

  return (
    <div
      className={cn(
        'border border-border rounded-xl bg-background overflow-hidden transition-all',
        isCritical && !resolved && 'ring-1 ring-red-500/30 border-red-500/40'
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="mt-0.5 flex-shrink-0">
          {resolved
            ? <CheckCircle2 size={16} className="text-emerald-500" />
            : isCritical
              ? <XCircle size={16} className="text-red-500" />
              : <HelpCircle size={16} className="text-muted-foreground/60" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap mb-1.5">
            <h4 className="text-sm font-semibold text-foreground leading-snug flex-1 min-w-[200px]">{q.text}</h4>
            <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border uppercase tracking-wide', pm.className)}>
              <span className={cn('w-1.5 h-1.5 rounded-full', pm.dot)} />
              {isCritical ? 'Critical' : pm.label}
            </span>
          </div>
          {q.rationale && (
            <p className="text-[11px] text-muted-foreground/90 leading-snug">{q.rationale}</p>
          )}
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <ConfidenceBar value={q.confidence_score || 0} label="AI Confidence" />
            <ConfidenceBar value={q.risk_score || 0} label="Risk Score" />
            {q.weight != null && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>Gap weight:</span>
                <span className="font-semibold tabular-nums text-foreground">{q.weight}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 mt-1 text-muted-foreground/60">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-border/50 pt-3">
          {q.suggested_answer && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold text-primary/80">
                  <Wand2 size={11} />
                  AI Suggested Answer
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUseSuggestion(q.id, q.suggested_answer);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                >
                  <Sparkles size={10} />
                  Use Suggestion
                </button>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{q.suggested_answer}</p>
            </div>
          )}

          <div>
            <textarea
              className={cn(
                'w-full text-sm border border-border rounded-lg p-2.5 min-h-[80px] transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary bg-secondary/40',
                resolved && 'border-emerald-500/40'
              )}
              placeholder="Type your answer here…"
              value={answers[q.id] || q.user_answer || ''}
              onChange={(e) => onAnswer(q.id, e.target.value)}
            />
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {resolved
                  ? <>
                      <CheckCircle2 size={10} className="text-emerald-500" />
                      <span className="text-emerald-500 font-medium">Answered</span>
                    </>
                  : isCritical
                    ? <>
                        <AlertTriangle size={10} className="text-red-500" />
                        <span className="text-red-500 font-medium">Answer required to proceed</span>
                      </>
                    : <>
                        <HelpCircle size={10} />
                        <span>Unanswered</span>
                      </>}
              </div>
              {answers[q.id] && (
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(answers[q.id]);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Copy size={10} /> Copy
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryGroupCard({ group, questions, onAnswer, onUseSuggestion, answers, riskThreshold, openByDefault }) {
  const [open, setOpen] = useState(openByDefault);
  const Icon = group.icon;
  const resolvedCount = questions.filter((q) => q.is_resolved || (answers[q.id] && answers[q.id].trim().length > 0)).length;
  const criticalCount = questions.filter((q) => q.priority === 'critical' || (q.risk_score || 0) >= (riskThreshold || 70)).length;
  const unresolvedCritical = questions.filter(
    (q) => (q.priority === 'critical' || (q.risk_score || 0) >= (riskThreshold || 70)) && !(q.is_resolved || (answers[q.id] && answers[q.id].trim().length > 0))
  ).length;
  const progress = questions.length === 0 ? 0 : Math.round((resolvedCount / questions.length) * 100);

  return (
    <div className={cn('glass-card rounded-xl overflow-hidden border-l-4', group.border)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0', group.bg)}>
          <Icon size={18} className={group.text} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-bold text-foreground">{group.label}</h3>
            {criticalCount > 0 && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide',
                unresolvedCritical > 0
                  ? 'bg-red-500/10 text-red-600 border border-red-500/30'
                  : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
              )}>
                {unresolvedCritical > 0 && <AlertTriangle size={10} />}
                {criticalCount} Critical {criticalCount === 1 ? 'Question' : 'Questions'}
                {unresolvedCritical === 0 && criticalCount > 0 && <CheckCircle2 size={10} />}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {resolvedCount}/{questions.length} answered · {progress}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{group.description}</p>
          <div className="mt-2 w-full h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                progress === 100 ? 'bg-emerald-500' : unresolvedCritical > 0 ? 'bg-red-500' : 'bg-amber-500'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="flex-shrink-0 mt-1 text-muted-foreground/60">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/60 pt-3 bg-secondary/10">
          {questions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-center">
              <p className="text-xs text-muted-foreground">No questions in this category.</p>
            </div>
          ) : (
            questions.map((q) => (
              <QuestionCard
                key={q.id}
                q={q}
                onAnswer={onAnswer}
                onUseSuggestion={onUseSuggestion}
                answers={answers}
                riskThreshold={riskThreshold}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ReviewQuestionsSection({ workflow, onRefresh, onSwitchTab }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await getQuestions(workflow.id);
        if (cancelled) return;
        setData(res);
        const initialAnswers = {};
        res.questions?.forEach((q) => {
          if (q.user_answer) initialAnswers[q.id] = q.user_answer;
        });
        setAnswers(initialAnswers);
      } catch (err) {
        if (cancelled) return;
        toast.error('Failed to load questions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [workflow.id, toast]);

  const handleAnswerChange = (id, text) => {
    setAnswers((prev) => ({ ...prev, [id]: text }));
  };

  const handleUseSuggestion = (id, suggestion) => {
    setAnswers((prev) => ({ ...prev, [id]: suggestion }));
    toast.success('Suggestion applied');
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = Object.entries(answers).map(([id, ans]) => ({ question_id: id, answer: ans }));
      const res = await submitAnswers(workflow.id, payload);
      toast.success('Answers saved');
      // Re-fetch questions to reflect latest server-computed scores/gates
      const fresh = await getQuestions(workflow.id);
      setData(fresh);
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error('Failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateSdd = async () => {
    // First: switch to the Analysis tab immediately so user sees real-time progress
    if (onSwitchTab) onSwitchTab('analysis');
    // Then save answers so SDD agent has the latest context
    setSubmitting(true);
    try {
      const payload = Object.entries(answers).map(([id, ans]) => ({ question_id: id, answer: ans }));
      await submitAnswers(workflow.id, payload);
      await startGeneration(workflow.id, 'sdd_generation');
      toast.success('SDD generation started');
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error(`Failed to start: ${err?.response?.data?.error?.message || err.message || 'Unknown error'}`);
      // On failure, bring user back to questions tab so they can retry
      if (onSwitchTab) onSwitchTab('questions');
    } finally {
      setSubmitting(false);
    }
  };

  const needsGapAnalysis =
    !data?.questions?.length ||
    ['created', 'files_uploaded', 'summary_generated'].includes(workflow.status);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">Loading review questions…</p>
      </div>
    );
  }

  if (needsGapAnalysis) {
    return (
      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
        <div className="p-3 rounded-2xl bg-secondary inline-block mb-3">
          <Sparkles size={22} className="text-amber-500" />
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {!data?.questions?.length ? 'No review questions generated yet' : 'Gap analysis not yet run'}
        </h3>
        <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
          Run the AI gap analysis to identify ambiguous requirements, missing specifications,
          and risk areas that must be clarified before drafting the Solution Design Document.
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              await _startGen(workflow.id, 'gap_analysis');
              toast.success('Gap analysis started — you will be switched to the Analysis tab to watch progress.');
              if (onSwitchTab) onSwitchTab('analysis');
              if (onRefresh) onRefresh();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles size={14} />
            Run Gap Analysis
          </button>
          <button
            onClick={async () => {
              setLoading(true);
              try {
                const fresh = await getQuestions(workflow.id);
                setData(fresh);
                toast.success('Reloaded questions');
              } catch {
                toast.error('Reload failed');
              } finally {
                setLoading(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-secondary text-foreground hover:bg-secondary/80"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  // Group questions by normalized category
  const grouped = useMemo(() => {
    const map = Object.fromEntries(CATEGORY_GROUPS.filter((g) => !g.foldInto).map((g) => [g.key, []]));
    for (const q of data.questions) {
      const normalized = resolveCategory(q.category);
      if (!map[normalized]) map.other.push(q);
      else map[normalized].push(q);
    }
    // Sort questions per-group: critical first, then by risk desc, then by confidence desc
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const rank = (q) => (q.priority === 'critical' ? 0 : q.priority === 'suggested' ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if ((b.risk_score || 0) !== (a.risk_score || 0)) return (b.risk_score || 0) - (a.risk_score || 0);
        return (b.confidence_score || 0) - (a.confidence_score || 0);
      });
    }
    return map;
  }, [data.questions]);

  const completionPct = typeof data.completion_pct === 'number' ? data.completion_pct : 0;
  const gapScore = data.gap_score ?? 0;
  const gapThreshold = data.gap_threshold ?? 30;
  const minCompletion = data.min_analysis_completion ?? 80;
  const riskThreshold = data.risk_critical_threshold ?? 70;
  const allCriticalResolved = !!data.all_critical_resolved;
  const canProceed = !!data.can_proceed_to_sdd;
  const completionPctMet = completionPct >= minCompletion;
  const thresholdMet = gapScore <= gapThreshold;

  return (
    <div className="space-y-5">
      {/* Overview banner with progress */}
      <div className="glass-card rounded-xl p-5 bg-gradient-to-br from-secondary/40 to-background border border-border">
        <div className="flex flex-col md:flex-row md:items-start gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Shield size={16} className="text-primary" />
                Gap Review Overview
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Answer questions to reduce ambiguity before SDD generation. Critical questions are gated and must be answered.
              </p>
            </div>

            {/* Three-bar progress indicators */}
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Overall Completion (weighted)</span>
                  <span className={cn('text-[11px] font-bold tabular-nums', completionPctMet ? 'text-emerald-500' : 'text-amber-500')}>
                    {completionPct}% / {minCompletion}% required
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', completionPctMet ? 'bg-emerald-500' : 'bg-amber-500')}
                    style={{ width: `${Math.min(100, completionPct)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Gap Score</span>
                  <span className={cn('text-[11px] font-bold tabular-nums', thresholdMet ? 'text-emerald-500' : 'text-rose-500')}>
                    {gapScore} / {gapThreshold} max allowed
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', thresholdMet ? 'bg-emerald-500' : 'bg-rose-500')}
                    style={{ width: `${Math.min(100, (gapScore / Math.max(gapThreshold, 1)) * 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Critical Questions Resolved</span>
                  <span className={cn('text-[11px] font-bold tabular-nums', allCriticalResolved ? 'text-emerald-500' : 'text-red-500')}>
                    {allCriticalResolved ? 'All answered' : `${data.unresolved_critical_ids?.length || 0} remaining`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {allCriticalResolved
                    ? <CheckCircle size={14} className="text-emerald-500" />
                    : <AlertTriangle size={14} className="text-red-500" />}
                  <p className="text-[11px] text-muted-foreground">
                    {allCriticalResolved
                      ? 'All required critical gaps have been addressed.'
                      : 'You must answer every critical question before SDD can be generated.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Gate status badge */}
          <div className="flex-shrink-0 md:min-w-[220px]">
            <div
              className={cn(
                'rounded-xl border p-4 h-full flex flex-col justify-center gap-2',
                canProceed
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-amber-500/40 bg-amber-500/5'
              )}
            >
              <div className="flex items-center gap-2">
                {canProceed
                  ? <CheckCircle2 size={18} className="text-emerald-500" />
                  : <Lock size={18} className="text-amber-500" />}
                <span className={cn('text-sm font-bold', canProceed ? 'text-emerald-600' : 'text-amber-600')}>
                  {canProceed ? 'Ready for SDD' : 'Review Incomplete'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {canProceed
                  ? 'All review gates have been met. Generate the SDD anytime.'
                  : 'Resolve all remaining requirements below to unlock SDD generation.'}
              </p>
              {!canProceed && (
                <ul className="text-[10px] space-y-0.5 text-muted-foreground list-disc pl-4">
                  {!allCriticalResolved && <li>Answer all critical questions</li>}
                  {!completionPctMet && <li>Raise completion to at least {minCompletion}%</li>}
                  {!thresholdMet && <li>Reduce gap score below {gapThreshold}</li>}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Category groups */}
      <div className="space-y-4">
        {CATEGORY_GROUPS.filter((g) => !g.foldInto).map((g) => (
          <CategoryGroupCard
            key={g.key}
            group={g}
            questions={grouped[g.key] || []}
            onAnswer={handleAnswerChange}
            onUseSuggestion={handleUseSuggestion}
            answers={answers}
            riskThreshold={riskThreshold}
            openByDefault={(grouped[g.key] || []).some((q) => q.priority === 'critical')}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end sm:items-center border-t border-border pt-4">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-60"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
          Save Answers
        </button>
        <button
          onClick={handleGenerateSdd}
          disabled={submitting || !canProceed}
          className={cn(
            'flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed',
            canProceed
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-primary/50 text-primary-foreground/70'
          )}
          title={!canProceed ? 'Resolve all required items above before generating the SDD' : 'Generate SDD document for preview'}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
          Generate SDD Preview
        </button>
      </div>
    </div>
  );
}
