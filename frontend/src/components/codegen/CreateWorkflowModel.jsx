import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { createWorkflow } from '../../api/codegen';
import { PRIMARY_USAGES } from '../../lib/eucMeta';

export default function CreateWorkflowModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    primary_usage: '',
    business_unit: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Workflow name is required');
      return;
    }
    setSubmitting(true);
    try {
      const wf = await createWorkflow(form);
      onCreated(wf);
    } catch (err) {
      setError(err?.response?.data?.error?.message || err.message || 'Failed to create workflow');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Create CodeGen Workflow</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Workflow Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              placeholder="e.g. Customer Migration Service"
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm text-foreground placeholder-muted-foreground',
                'bg-background border-border focus:border-ring focus:ring-1 focus:ring-ring',
                'outline-none transition-colors'
              )}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={handleChange('description')}
              rows={2}
              placeholder="Brief description of what this workflow generates..."
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm text-foreground placeholder-muted-foreground',
                'bg-background border-border focus:border-ring focus:ring-1 focus:ring-ring',
                'outline-none transition-colors resize-none'
              )}
            />
          </div>

          {/* Primary Usage */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Primary Usage</label>
            <select
              value={form.primary_usage}
              onChange={handleChange('primary_usage')}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm text-foreground',
                'bg-background border-border focus:border-ring focus:ring-1 focus:ring-ring',
                'outline-none transition-colors'
              )}
            >
              <option value="">Select usage</option>
              {PRIMARY_USAGES.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          {/* Business Unit */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Business Unit</label>
            <input
              type="text"
              value={form.business_unit}
              onChange={handleChange('business_unit')}
              placeholder="e.g. Finance, Risk & Control"
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border text-sm text-foreground placeholder-muted-foreground',
                'bg-background border-border focus:border-ring focus:ring-1 focus:ring-ring',
                'outline-none transition-colors'
              )}
            />
          </div>

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm'
              )}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Workflow
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}