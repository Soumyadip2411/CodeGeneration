/**
 * CodegenMetaBar - collapsible metadata strip for codegen workflows.
 *
 * Mirrors the analyzer's WorkflowMetaBar pattern: collapsed shows description + chips,
 * expanded shows editable fields (name, primary usage, business unit, description).
 * Each field saves on Enter/blur via PATCH /api/codegen/workflows/{id}.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, Target, Building2, Workflow, Pencil, FileText, Type,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { PRIMARY_USAGES, SOFT_CHIP } from '../../lib/eucMeta';
import { updateWorkflow } from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';

function EditField({ icon: Icon, label, value, accent = 'text-muted-foreground', onSave, options = null, multiline = false, placeholder = 'Add...', full = false }) {
  const empty = value === null || value === undefined || value === '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select?.();
    }
  }, [editing]);

  const begin = () => { setDraft(value || ''); setEditing(true); };
  const save = () => {
    if ((draft || '') !== (value || '')) onSave?.(draft);
    setEditing(false);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !multiline) save();
    else if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div className={cn('flex items-start gap-2.5', full ? 'sm:col-span-2 lg:col-span-4' : '')}>
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Icon size={14} className={accent} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {!editing ? (
          <button
            type="button"
            onClick={begin}
            className={cn(
              'group flex w-full items-start gap-1.5 text-left text-sm font-medium transition-colors hover:text-primary',
              empty ? 'italic text-muted-foreground/60 hover:text-muted-foreground' : 'text-foreground',
            )}
          >
            <span className={cn('min-w-0 break-words', multiline && 'line-clamp-2')}>{empty ? placeholder : value}</span>
            <Pencil size={11} className="mt-0.5 flex-shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
          </button>
        ) : options ? (
          <select
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={onKey}
            className="w-full rounded border border-ring bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">-- Select --</option>
            {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : multiline ? (
          <textarea
            ref={ref}
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={onKey}
            placeholder={placeholder}
            className="w-full resize-none rounded border border-ring bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <input
            ref={ref}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={onKey}
            placeholder={placeholder}
            className="w-full rounded border border-ring bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>
    </div>
  );
}

export default function CodegenMetaBar({ workflow, onUpdate }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const handleFieldSave = async (patch) => {
    try {
      await updateWorkflow(workflow.id, patch);
      if (onUpdate) onUpdate();
      toast.success('Workflow updated');
    } catch (err) {
      toast.error('Update failed');
    }
  };

  const chips = [
    workflow.primary_usage && { label: workflow.primary_usage, cls: SOFT_CHIP.blue },
    workflow.business_unit && { label: workflow.business_unit, cls: SOFT_CHIP.violet },
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left"
      >
        <Workflow size={14} className="flex-shrink-0 text-primary" />
        {!open ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {workflow.description ? (
              <span className="truncate text-xs text-muted-foreground">{workflow.description}</span>
            ) : (
              <span className="text-xs font-semibold text-foreground">Workflow details</span>
            )}
            <div className="hidden flex-shrink-0 items-center gap-1.5 sm:flex">
              {chips.slice(0, 2).map((c, i) => (
                <span key={i} className={cn('inline-flex max-w-[160px] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', c.cls)}>
                  {c.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <span className="flex-1 text-xs font-semibold text-foreground">Workflow details</span>
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          {open ? <>Hide <ChevronUp size={13} /></> : <>Edit <ChevronDown size={13} /></>}
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border px-3.5 py-3.5 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
          <EditField
            icon={Type}
            label="Workflow Name"
            value={workflow.name}
            accent="text-primary"
            placeholder="Name this workflow"
            onSave={(val) => { if (val.trim()) handleFieldSave({ name: val.trim() }); }}
          />
          <EditField
            icon={Target}
            label="Primary Usage"
            value={workflow.primary_usage}
            accent="text-blue-600 dark:text-blue-400"
            options={PRIMARY_USAGES}
            placeholder="Select usage"
            onSave={(val) => handleFieldSave({ primary_usage: val })}
          />
          <EditField
            icon={Building2}
            label="Business Unit"
            value={workflow.business_unit}
            accent="text-violet-600 dark:text-violet-400"
            placeholder="e.g. Finance, Risk & Control"
            onSave={(val) => handleFieldSave({ business_unit: val })}
          />
          <EditField
            icon={FileText}
            label="Description"
            value={workflow.description}
            accent="text-muted-foreground"
            multiline
            full
            placeholder="Brief description of this workflow and its purpose..."
            onSave={(val) => handleFieldSave({ description: val })}
          />
        </div>
      )}
    </div>
  );
}