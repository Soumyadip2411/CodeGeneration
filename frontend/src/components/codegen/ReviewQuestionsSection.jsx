import React, { useEffect, useState } from 'react';
import { getQuestions, submitAnswers, startGeneration } from '../../api/codegen';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';

export default function ReviewQuestionsSection({ workflow, onRefresh, onSwitchTab }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await getQuestions(workflow.id);
        setData(res);
        const initialAnswers = {};
        res.questions?.forEach(q => {
          if (q.user_answer) initialAnswers[q.id] = q.user_answer;
        });
        setAnswers(initialAnswers);
      } catch (err) {
        toast.error('Failed to load questions');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [workflow.id]);

  const handleAnswerChange = (id, text) => {
    setAnswers(prev => ({ ...prev, [id]: text }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = Object.entries(answers).map(([id, ans]) => ({ question_id: id, answer: ans }));
      const res = await submitAnswers(workflow.id, payload);
      toast.success('Answers submitted successfully');
      setData(prev => ({ ...prev, gap_score: res.gap_score }));
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error('Failed to submit answers');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateSdd = async () => {
    setSubmitting(true);
    try {
      await startGeneration(workflow.id, 'sdd_generation');
      toast.success('Generating SDD...');
      if (onRefresh) onRefresh();
      if (onSwitchTab) onSwitchTab('progress');
    } catch (err) {
      toast.error('Failed to start SDD generation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  }

  if (!data?.questions?.length) {
    return (
      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
        <p className="text-muted-foreground">No review questions generated yet. Start the Gap Analysis phase.</p>
        <button 
          onClick={async () => {
             await startGeneration(workflow.id, 'gap_analysis');
             toast.success('Gap analysis started');
             if (onSwitchTab) onSwitchTab('progress');
             if (onRefresh) onRefresh();
          }}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
        >
          Run Gap Analysis
        </button>
      </div>
    );
  }

  const thresholdMet = data.gap_score <= data.gap_threshold;

  return (
    <div className="space-y-6">
      <div className="glass-card p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Gap Score: {data.gap_score} / {data.gap_threshold} (Max Allowed)</h3>
          <p className="text-xs text-muted-foreground">Resolve questions to lower the gap score.</p>
        </div>
        {thresholdMet ? (
          <span className="flex items-center gap-1 text-emerald-500 text-sm font-medium"><CheckCircle className="w-4 h-4"/> Threshold Met</span>
        ) : (
          <span className="flex items-center gap-1 text-amber-500 text-sm font-medium"><AlertTriangle className="w-4 h-4"/> High Gap</span>
        )}
      </div>

      <div className="space-y-4">
        {data.questions.map(q => (
          <div key={q.id} className="border border-border rounded-lg p-4 bg-background">
            <div className="flex justify-between items-start mb-2">
              <h4 className="text-sm font-medium">{q.text}</h4>
              <span className="text-[10px] px-2 py-1 bg-secondary rounded-full uppercase">{q.category}</span>
            </div>
            {q.suggested_answer && (
              <p className="text-xs text-muted-foreground mb-3 border-l-2 border-primary/50 pl-2">
                Suggestion: {q.suggested_answer}
              </p>
            )}
            <textarea
              className="w-full text-sm bg-secondary/50 border border-border rounded p-2 min-h-[60px]"
              placeholder="Your answer..."
              value={answers[q.id] || ''}
              onChange={(e) => handleAnswerChange(q.id, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3 justify-end border-t border-border pt-4">
        <button 
          onClick={handleSubmit} 
          disabled={submitting}
          className="px-4 py-2 bg-secondary text-foreground rounded-lg text-sm"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Answers'}
        </button>
        <button 
          onClick={handleGenerateSdd} 
          disabled={!thresholdMet || submitting}
          className={cn("px-4 py-2 text-primary-foreground rounded-lg text-sm", thresholdMet ? "bg-primary" : "bg-primary/50 cursor-not-allowed")}
        >
          Proceed to SDD
        </button>
      </div>
    </div>
  );
}
