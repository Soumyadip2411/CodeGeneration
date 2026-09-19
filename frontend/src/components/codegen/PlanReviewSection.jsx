import React, { useEffect, useState, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  approveSdd, getSddPreview, startGeneration, getArtifactFile, getArtifactTree,
} from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';
import {
  Loader2, CheckCircle2, FileText, Play, FileDown, ArrowLeft, ArrowRight,
  Clock, AlertCircle, Shield, List, Sparkles, ChevronRight, ChevronDown, Copy, Download,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Extract top-level headings (# and ##) as section anchors
function extractSections(md) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const sections = [];
  const headingMap = new Map();
  let index = 0;
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      const slug = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-|-$/g, '') || `sec-${index}`;
      let uniqueSlug = slug;
      let i = 1;
      while (headingMap.has(uniqueSlug)) {
        uniqueSlug = `${slug}-${i++}`;
      }
      headingMap.set(uniqueSlug, true);
      sections.push({ title, slug, level, index: index++ });
    }
  }
  return sections;
}

// Renderers for React Markdown - add ids to headings so section nav can jump to them
function makeMarkdownComponents(onCopy) {
  return {
    h1: ({ children, ...rest }) => {
      const id = headingId(children);
      return (
        <h1 id={id} {...rest} className="text-xl font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border/70 flex items-start gap-2">
          <span className="flex-1">{children}</span>
          <button onClick={() => onCopy && onCopy(`# ${children}`)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground">
            <Copy size={12} />
          </button>
        </h1>
      );
    },
    h2: ({ children, ...rest }) => {
      const id = headingId(children);
      return (
        <h2 id={id} {...rest} className="group text-lg font-bold text-foreground mt-8 mb-3 flex items-start gap-2 scroll-mt-24">
          <span className="flex-1">{children}</span>
          <button
            onClick={() => onCopy && onCopy(`## ${children}`)}
            className="mt-1 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            title="Copy heading"
          >
            <Copy size={12} />
          </button>
        </h2>
      );
    },
    h3: ({ children, ...rest }) => {
      const id = headingId(children);
      return (
        <h3 id={id} {...rest} className="group text-base font-semibold text-foreground mt-5 mb-2 flex items-start gap-2 scroll-mt-24">
          <span className="flex-1">{children}</span>
          <button
            onClick={() => onCopy && onCopy(`### ${children}`)}
            className="mt-0.5 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            title="Copy heading"
          >
            <Copy size={11} />
          </button>
        </h3>
      );
    },
    p: ({ children }) => (
      <p className="text-sm text-foreground/90 leading-relaxed my-2">{children}</p>
    ),
    ul: ({ children }) => <ul className="list-disc pl-6 my-2 text-sm space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-6 my-2 text-sm space-y-1">{children}</ol>,
    li: ({ children }) => <li className="text-foreground/90 leading-relaxed">{children}</li>,
    table: ({ children }) => (
      <div className="my-4 rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-secondary/60">{children}</thead>,
    th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-foreground border-b border-border">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 border-b border-border/60 align-top">{children}</td>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-primary/60 bg-primary/5 px-4 py-2 rounded-r-md text-sm text-foreground/85">
        {children}
      </blockquote>
    ),
    code: ({ className, children, inline, ...rest }) => {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      if (inline) {
        return (
          <code className="px-1.5 py-0.5 rounded bg-secondary text-[12px] font-mono text-foreground/90 border border-border/60" {...rest}>
            {children}
          </code>
        );
      }
      const codeString = String(children ?? '').replace(/\n$/, '');
      return (
        <div className="group relative my-3 rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/60 border-b border-border/60 text-[11px]">
            <span className="font-mono uppercase text-muted-foreground tracking-wider">{lang || 'code'}</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(codeString);
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Copy size={10} /> Copy
            </button>
          </div>
          <pre className="overflow-x-auto px-3 py-3 text-[12px] font-mono leading-relaxed bg-card text-foreground/95">
            <code className={className} {...rest}>{children}</code>
          </pre>
        </div>
      );
    },
    hr: () => <hr className="my-5 border-border/70" />,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    ),
    strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
  };
}

function headingId(children) {
  const text = (Array.isArray(children) ? children : [children])
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('');
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function PlanReviewSection({ workflow, onRefresh, onSwitchTab }) {
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMarkdown, setPreviewMarkdown] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [tocOpen, setTocOpen] = useState(true);
  const toast = useToast();
  const contentRef = useRef(null);
  // Guard against auto-scroll on mount / content load. Only permit user-initiated jumps.
  const allowJumpRef = useRef(false);

  // Fetch SDD preview
  useEffect(() => {
    async function load() {
      if (workflow.status !== 'plan_generated' && workflow.status !== 'plan_approved' && workflow.status !== 'completed') return;
      setPreviewLoading(true);
      try {
        let markdown = workflow.sdd_preview_markdown || '';
        // Prefer the dedicated endpoint (has fallbacks)
        const res = await getSddPreview(workflow.id);
        if (res?.markdown) markdown = res.markdown;

        // Last-ditch: try artifact tree + SDD.md from artifacts
        if (!markdown && workflow.latest_run_id) {
          try {
            const tree = await getArtifactTree(workflow.latest_run_id);
            const sddEntry = tree.find((e) => (e.path || '').toLowerCase().endsWith('sdd.md'));
            if (sddEntry) {
              markdown = await getArtifactFile(workflow.latest_run_id, sddEntry.path);
            }
          } catch {}
        }

        setPreviewMarkdown(markdown || '');
      } catch (err) {
        console.error(err);
        toast.error('Failed to load SDD preview');
      } finally {
        setPreviewLoading(false);
      }
    }
    load();
  }, [workflow.id, workflow.status, workflow.latest_run_id, workflow.sdd_preview_markdown, toast]);

  // After mount, enable user-initiated TOC jumps. Until then, any scrollIntoView is blocked.
  // This prevents content/mount side effects from yanking the user's scroll position.
  useEffect(() => {
    const t = setTimeout(() => { allowJumpRef.current = true; }, 350);
    return () => clearTimeout(t);
  }, []);

  const sections = useMemo(() => extractSections(previewMarkdown), [previewMarkdown]);

  const jumpTo = (slug) => {
    setActiveSection(slug);
    if (!allowJumpRef.current) return;
    let safe = slug;
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      safe = CSS.escape(slug);
    } else {
      safe = slug.replace(/([^\w-])/g, '\\$1');
    }
    const el = contentRef.current?.querySelector(`#${safe}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Build copy handler
  const handleCopy = (text) => {
    navigator.clipboard?.writeText(text);
    toast.info('Copied');
  };

  const markdownComponents = useMemo(() => makeMarkdownComponents(handleCopy), []);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await approveSdd(workflow.id);
      toast.success('SDD Approved');
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error('Failed to approve SDD');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateCode = async () => {
    setSubmitting(true);
    try {
      await startGeneration(workflow.id, 'code_generation');
      toast.success('Code generation started');
      if (onSwitchTab) onSwitchTab('progress');
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error(`Failed to start: ${err?.response?.data?.error?.message || err.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const isApproved = workflow.status === 'plan_approved' || workflow.status === 'completed';
  const isReadyForView = workflow.status === 'plan_generated' || isApproved;

  if (!isReadyForView) {
    return (
      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
        <div className="p-3 rounded-2xl bg-secondary inline-block mb-3">
          <Clock size={20} className="text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          The SDD preview is not ready yet. Complete the gap analysis and review questions first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Approval / status header */}
      <div
        className={cn(
          'glass-card rounded-xl p-5 border-l-4 transition-colors',
          isApproved ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-purple-500'
        )}
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0',
                isApproved ? 'bg-emerald-500/10' : 'bg-purple-500/10'
              )}
            >
              {isApproved ? (
                <CheckCircle2 size={22} className="text-emerald-500" />
              ) : (
                <FileText size={22} className="text-purple-500 animate-pulse" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
                  <Sparkles size={14} className="text-purple-500" />
                  System Design Document (SDD)
                </h2>
                {isApproved ? (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 font-semibold uppercase tracking-wide">
                    <CheckCircle2 size={10} /> Approved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 font-semibold uppercase tracking-wide animate-pulse">
                    <AlertCircle size={10} /> Awaiting Review
                  </span>
                )}
                {previewMarkdown && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {sections.length} section{sections.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                {isApproved
                  ? 'SDD has been approved. Start code generation to produce the final artifacts.'
                  : 'Review the SDD carefully. Approve to lock in requirements and proceed to code generation.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            {/* SDD copy/download buttons — only shown during review stage, not after code generation */}
            {workflow.status !== 'completed' && (
              <>
                <button
                  onClick={() => {
                    if (previewMarkdown) {
                      navigator.clipboard?.writeText(previewMarkdown);
                      toast.success('SDD markdown copied to clipboard');
                    }
                  }}
                  disabled={!previewMarkdown}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-60"
                  title="Copy entire SDD as markdown"
                >
                  <Copy size={12} />
                  Copy SDD
                </button>
                <button
                  onClick={() => {
                    if (!previewMarkdown) return;
                    const blob = new Blob([previewMarkdown], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SDD-${workflow.id.slice(0, 8)}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success('SDD downloaded');
                  }}
                  disabled={!previewMarkdown}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-secondary text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-60"
                  title="Download SDD as Markdown file"
                >
                  <Download size={12} />
                  Download .md
                </button>
              </>
            )}
            {!isApproved ? (
              <button
                onClick={handleApprove}
                disabled={submitting || !previewMarkdown}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm disabled:opacity-60"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Approve SDD
              </button>
            ) : (
              <button
                onClick={handleGenerateCode}
                disabled={submitting || workflow.status === 'completed'}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {workflow.status === 'completed' ? 'Re-run Code Generation' : 'Generate Code'}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content: Sidebar TOC + Markdown */}
      {previewLoading ? (
        <div className="glass-card p-10 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading SDD preview…</p>
          </div>
        </div>
      ) : previewMarkdown ? (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4">
          {/* TOC — outer wrapper clips radius; inner nav is fully scrollable */}
          <div
            className="glass-card rounded-xl overflow-hidden lg:sticky lg:top-4 flex flex-col"
            style={{ maxHeight: 'calc(100vh - 220px)' }}
          >
            <button
              onClick={() => setTocOpen((v) => !v)}
              className="flex-shrink-0 w-full flex items-center justify-between px-4 py-3 border-b border-border/60 hover:bg-secondary/40 transition-colors rounded-t-xl"
            >
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-foreground/80">
                <List size={12} />
                Sections
              </span>
              <span className="text-muted-foreground lg:hidden">
                {tocOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {(tocOpen || true) && (
              <nav className="flex-1 min-h-0 overflow-y-auto py-2 lg:block">
                <div className="px-1 pb-1">
                  {sections.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground/70 italic">
                      No headings detected.
                    </p>
                  ) : (
                    sections.map((s) => (
                      <button
                        key={s.slug + s.index}
                        onClick={() => jumpTo(s.slug)}
                        className={cn(
                          'w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2',
                          activeSection === s.slug
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                          s.level === 3 && 'pl-7'
                        )}
                        style={{ paddingLeft: `${s.level === 1 ? 12 : s.level === 2 ? 12 : 28}px` }}
                      >
                        <span className="flex-1 truncate leading-tight">
                          {s.title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </nav>
            )}
          </div>

          {/* Markdown */}
          <div
            ref={contentRef}
            className="glass-card rounded-xl p-6 md:p-8 min-h-[500px] prose-invert max-w-none"
          >
            <ReactMarkdown components={markdownComponents} skipHtml={false}>
              {previewMarkdown}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-10 text-center border-2 border-dashed border-border/70">
          <FileDown size={28} className="mx-auto text-muted-foreground/70 mb-3" />
          <h3 className="text-sm font-semibold text-foreground mb-1">SDD not yet available for inline preview</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
            The SDD has been generated but could not be displayed inline. Try running the generation again,
            or revisit the SDD Preview tab after regeneration.
          </p>
          <button
            onClick={() => onSwitchTab && onSwitchTab('questions')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
          >
            <ArrowLeft size={12} />
            Back to Questions
          </button>
        </div>
      )}

      {/* Security / approval checklist */}
      <div className="glass-card rounded-xl p-5 border-l-4 border-rose-500/60 bg-rose-500/5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/10 flex-shrink-0">
            <Shield size={16} className="text-rose-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-foreground mb-1">Approval Checklist</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Please confirm all of the following before approving the SDD:
            </p>
            <ul className="space-y-1.5">
              {[
                'All functional requirements from the uploaded design documents are reflected in the SDD',
                'Security (auth, RBAC, PII, encryption) and compliance requirements are specified',
                'Data models, schemas, and transformation logic are correct',
                'Inputs, outputs, validations, and error handling are complete',
                'No TBDs, placeholders, or unresolved assumptions remain',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/85">
                  <CheckCircle2 size={12} className={cn('mt-0.5 flex-shrink-0', isApproved ? 'text-emerald-500' : 'text-muted-foreground/50')} />
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
