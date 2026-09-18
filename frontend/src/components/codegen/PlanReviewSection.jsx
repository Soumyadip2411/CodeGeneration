import React, { useState } from 'react';
import { approveSdd, startGeneration } from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';
import { Loader2 } from 'lucide-react';

export default function PlanReviewSection({ workflow, onRefresh, onSwitchTab }) {
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

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
      toast.error('Failed to start code generation');
    } finally {
      setSubmitting(false);
    }
  };

  if (workflow.status !== 'plan_generated' && workflow.status !== 'plan_approved' && workflow.status !== 'completed') {
    return (
      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
        <p className="text-muted-foreground">The System Design Document (SDD) is not ready yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 border-l-4 border-primary">
        <h3 className="text-lg font-medium mb-2">System Design Document (Preview)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          The SDD has been generated and is available in the Artifacts. Please review it and approve to proceed with code generation.
        </p>
        <div className="flex gap-3">
          {workflow.status === 'plan_generated' ? (
            <button 
              onClick={handleApprove}
              disabled={submitting}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve SDD'}
            </button>
          ) : (
            <div className="space-x-3">
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full text-xs font-medium border border-emerald-500/20">
                Approved
              </span>
              <button 
                onClick={handleGenerateCode}
                disabled={submitting || workflow.status === 'completed'}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate Code'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
