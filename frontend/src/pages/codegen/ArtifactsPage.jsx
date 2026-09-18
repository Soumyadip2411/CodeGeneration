import { useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  Download,
  FileCode2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { getSpec, listArtifacts } from '../../api/codegen';
import { getTenantId } from '../../api/client';

function fmtTs(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function fmtSize(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ArtifactsPage() {
  const { specId } = useParams();
  const location = useLocation();
  const tenantId = location.state?.tenantId || getTenantId();

  const [spec, setSpec] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        getSpec(specId, { tenantId }),
        listArtifacts(specId, { tenantId }),
      ]);
      setSpec(s);
      setArtifacts(a || []);
    } catch (ex) {
      setError(ex?.response?.data?.error?.message || ex.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [specId]);

  return (
    <div className="px-8 py-8 animate-fade-rise">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/codegen/specs"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary"
            title="Back to specs"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Spec details</h2>
            <p className="font-mono text-xs text-muted-foreground">{specId}</p>
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
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
        </div>
      ) : !spec ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Spec not found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Spec metadata */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-1">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileCode2 size={14} /> Spec
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-mono text-foreground">{spec.status}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Tenant</dt>
                <dd className="font-mono text-foreground">{spec.tenant_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">EUC</dt>
                <dd className="font-mono text-foreground">{spec.euc_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Run</dt>
                <dd className="font-mono text-foreground">{spec.run_id}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Capability</dt>
                <dd className="font-mono text-foreground">{spec.capability_id || '-'}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="text-foreground">{fmtTs(spec.created_at)}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="text-foreground">{fmtTs(spec.updated_at)}</dd>
              </div>
              {spec.error && (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-700">
                  {spec.error}
                </div>
              )}
            </dl>
          </section>

          {/* Artifacts list */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Boxes size={14} /> Artifacts ({artifacts.length})
            </div>
            {artifacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No artifacts yet. They appear here once the generator publishes them.
              </p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {artifacts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-foreground">{a.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {a.kind} • {a.content_type || 'application/octet-stream'} • {fmtSize(a.size_bytes)}
                      </div>
                    </div>
                    {a.blob_path && (
                      <span
                        title={a.blob_path}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground"
                      >
                        <Download size={10} /> {a.blob_path.split('/').slice(-1)[0]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* PDD payload preview */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-3">
            <div className="mb-3 text-sm font-semibold text-foreground">PDD payload</div>
            <pre className="max-h-96 overflow-auto rounded-md bg-background p-3 text-[11px] text-foreground">
              {JSON.stringify(spec.pdd, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}