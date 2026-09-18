import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  Loader2,
  Package,
  RefreshCw,
  Send,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { listSpecs, publishSpec } from '../../api/codegen';
import { getTenantId } from '../../api/client';

function fmtTs(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function StatusPill({ status }) {
  const map = {
    queued:    'bg-amber-500/10 text-amber-600 border-amber-500/20',
    generating: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    ready:      'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    published:  'bg-violet-500/10 text-violet-600 border-violet-500/20',
    failed:     'bg-rose-500/10 text-rose-600 border-rose-500/20',
  };
  const cls = map[status] || 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status || 'unknown'}
    </span>
  );
}

export default function SpecsPage() {
  const [tenantId] = useState(getTenantId());
  const [specs, setSpecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [publishing, setPublishing] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const items = await listSpecs({ tenantId, status: statusFilter || undefined });
      setSpecs(items);
    } catch (ex) {
      setError(ex?.response?.data?.error?.message || ex.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const handlePublish = async (spec) => {
    setPublishing(spec.id);
    try {
      await publishSpec(spec.id, { tenantId: spec.tenant_id || tenantId });
      await load();
    } catch (ex) {
      setError(ex?.response?.data?.error?.message || ex.message);
    } finally {
      setPublishing(null);
    }
  };

  return (
    <div className="px-8 py-8 animate-fade-rise">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileCode2 size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Specs</h2>
            <p className="text-sm text-muted-foreground">
              PDD handoffs received from Analyzer · tenant <code className="font-mono">{tenantId}</code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="generating">Generating</option>
            <option value="ready">Ready</option>
            <option value="published">Published</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading specs...
        </div>
      ) : specs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
          <Package className="mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">No specs yet</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Approve a PDD in Analyzer and trigger the codegen handoff. Once received it will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Spec</th>
                <th className="px-4 py-2 text-left">EUC</th>
                <th className="px-4 py-2 text-left">Run</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-secondary/40">
                  <td className="px-4 py-2 font-mono text-[11px] text-foreground">{s.id}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-foreground">{s.euc_id}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-foreground">{s.run_id}</td>
                  <td className="px-4 py-2"><StatusPill status={s.status} /></td>
                  <td className="px-4 py-2 text-foreground">{fmtTs(s.created_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.status !== 'published' && (
                        <button
                          onClick={() => handlePublish(s)}
                          disabled={publishing === s.id}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-ey-yellow"
                        >
                          {publishing === s.id ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Send size={10} />
                          )}
                          Publish
                        </button>
                      )}
                      {s.status === 'published' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                          <CheckCircle2 size={10} /> Published
                        </span>
                      )}
                      <Link
                        to={`/codegen/specs/${encodeURIComponent(s.id)}`}
                        state={{ tenantId: s.tenant_id || tenantId }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        Details <ChevronRight size={10} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}