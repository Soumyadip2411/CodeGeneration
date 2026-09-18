import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Inbox,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { listCapabilities } from '../../api/codegen';
import { getTenantId } from '../../api/client';

function fmtTs(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function StatusPill({ status }) {
  const map = {
    available: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    deprecated: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  };
  const cls = map[status] || 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status || 'unknown'}
    </span>
  );
}

export default function CapabilitiesPage() {
  const [tenantId] = useState(getTenantId());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const items = await listCapabilities({ tenantId });
      setItems(items);
    } catch (ex) {
      setError(ex?.response?.data?.error?.message || ex.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="px-8 py-8 animate-fade-rise">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Published Capabilities</h2>
            <p className="text-sm text-muted-foreground">
              MCP tools published from CodeGen specs. End users discover these via their catalog.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading capabilities...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 py-16 text-center">
          <Inbox className="mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">No capabilities published yet</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Publish a spec from the Specs page to register a capability. The current tenant ({tenantId}) has no entries.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((cap) => (
            <section key={cap.id} className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{cap.name || cap.id}</h3>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{cap.id}</p>
                </div>
                <StatusPill status={cap.status} />
              </div>
              <dl className="mb-3 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Tenant</dt>
                  <dd className="font-mono text-foreground">{cap.tenant_id || '-'}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Spec</dt>
                  <dd className="font-mono text-foreground">{cap.spec_id || '-'}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">MCP tool</dt>
                  <dd className="font-mono text-foreground">
                    {cap.mcp_tool_uri || <span className="text-amber-600">not wired</span>}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Published</dt>
                  <dd className="text-foreground">{fmtTs(cap.published_at)}</dd>
                </div>
              </dl>
              {cap.description && (
                <p className="mt-auto text-xs text-muted-foreground line-clamp-3">{cap.description}</p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}