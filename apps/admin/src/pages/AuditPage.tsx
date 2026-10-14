import { useState } from 'react';
import { api, ApiError, qs } from '../services/api';
import type { Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, HashText, PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge } from '../components/ui/Badges';

interface AuditItem {
  auditId: string;
  sequence: number;
  occurredAt: string;
  actorRole: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  recordHash: string;
  previousHash: string;
  details: Record<string, unknown>;
}

export function AuditPage() {
  const { hasRole } = useAuth();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [verify, setVerify] = useState<{
    ok: boolean;
    checked: number;
    issues: unknown[];
    headSequence: number;
  } | null>(null);
  const [verr, setVerr] = useState<string | null>(null);
  const list = useApi(
    () =>
      api<Page<AuditItem>>(
        `/api/v1/audit-events${qs({ page, action: /^[A-Z_]{3,60}$/.test(action) ? action : '' })}`,
      ),
    [page, action],
  );
  const checkpoint = useApi(
    () =>
      api<{ sequence: number; recordHash: string; issuedAt: string }>(
        '/api/v1/audit-events/checkpoint',
      ),
    [],
  );
  return (
    <>
      <PageHeader
        title="Audit history"
        subtitle="Append-only, hash-linked record of security-relevant actions. Tampering is detectable only against an independently retained checkpoint."
      />
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card title="Current checkpoint">
          {checkpoint.data ? (
            <p className="text-sm">
              Sequence <strong>{checkpoint.data.sequence}</strong> ·{' '}
              <HashText value={checkpoint.data.recordHash} short />{' '}
              <span className="block text-xs text-ink-700">
                Record this value outside the system (e.g. in the duty register) to detect later
                rewrites.
              </span>
            </p>
          ) : (
            <LoadingState />
          )}
        </Card>
        <Card title="Verify audit chain">
          {hasRole('ADMIN') ? (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setVerr(null);
                  api<typeof verify>('/api/v1/audit-events/verify')
                    .then(setVerify)
                    .catch((e) => setVerr(e instanceof ApiError ? e.message : 'Failed'));
                }}
              >
                Run full verification
              </button>
              {verify && (
                <p role="status" className="mt-2 text-sm">
                  {verify.ok ? (
                    <Badge tone="ok">Chain intact</Badge>
                  ) : (
                    <Badge tone="bad">{verify.issues.length} issue(s) found</Badge>
                  )}{' '}
                  {verify.checked} records checked.
                </p>
              )}
              {verr && (
                <p role="alert" className="mt-2 text-sm text-signal-bad">
                  {verr}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-700">Full verification is an administrator action.</p>
          )}
        </Card>
      </div>
      <label className="mb-3 block max-w-xs text-sm">
        Action filter
        <input
          className="input mt-1 w-full font-mono"
          value={action}
          placeholder="e.g. EVIDENCE_EXPORTED"
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value.toUpperCase());
          }}
        />
      </label>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 && <EmptyState title="No audit records" />}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Time (server)</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Record hash</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.auditId}>
                  <td className="tabular-nums">{a.sequence}</td>
                  <td>{formatTime(a.occurredAt)}</td>
                  <td>{a.actorName ?? a.actorRole ?? 'system'}</td>
                  <td className="font-mono text-xs">{a.action}</td>
                  <td className="text-xs">
                    {a.targetType}
                    {a.targetId ? ` ${a.targetId.slice(0, 8)}` : ''}
                  </td>
                  <td>
                    <HashText value={a.recordHash} short />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && (
        <Pagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          onPage={setPage}
        />
      )}
    </>
  );
}
