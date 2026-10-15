import { useState } from 'react';
import { api, errorText, qs, send } from '../services/api';
import type { Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { StatusBadge } from '../components/ui/Badges';
import { Field, Notice, TextActionDialog } from '../components/ops/Ops';
import { t } from '../i18n';

interface Correction {
  id: string;
  targetType: string;
  targetId: string;
  fieldName: string;
  originalValue: unknown;
  correctedValue: unknown;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedAt: string;
  requestedByName: string;
  requestedBy: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
}

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? formatTime(v) : String(v));

export function CorrectionsPage() {
  const { can, user } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [decide, setDecide] = useState<{ c: Correction; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useApi(() => api<Page<Correction>>(`/api/v1/corrections${qs({ page, status })}`), [page, status]);
  return (
    <>
      <PageHeader title={t('corrections.title')} subtitle={t('corrections.subtitle')} />
      <div className="mb-3 max-w-xs">
        <Field label="Status">
          <select className="input w-full" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </Field>
      </div>
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.items.length && (
        <EmptyState title="No correction requests." hint="Personnel can request a correction from a duty page (for example a wrong reported start)." />
      )}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Record / field</th>
                <th scope="col">Original (kept)</th>
                <th scope="col">Proposed</th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td className="text-xs">
                    {c.targetType.replace('_', ' ').toLowerCase()} · {c.fieldName.replace('_', ' ')}
                    <p className="text-ink-700">
                      by {c.requestedByName} · {formatTime(c.requestedAt)}
                    </p>
                  </td>
                  <td className="text-xs">{show(c.originalValue)}</td>
                  <td className="text-xs">{show(c.correctedValue)}</td>
                  <td className="text-xs">{c.reason}</td>
                  <td className="text-xs">
                    <StatusBadge value={c.status === 'APPROVED' ? 'RESOLVED' : c.status === 'REJECTED' ? 'DISMISSED' : 'PENDING'} />
                    {c.decidedByName && (
                      <p className="mt-1 text-ink-700">
                        {c.status.toLowerCase()} by {c.decidedByName}: {c.decisionNote}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {c.status === 'PENDING' && can('correction.approve') && c.requestedBy !== user?.id && (
                      <>
                        <button type="button" className="underline" onClick={() => setDecide({ c, decision: 'APPROVE' })}>
                          Approve
                        </button>{' '}
                        ·{' '}
                        <button type="button" className="underline" onClick={() => setDecide({ c, decision: 'REJECT' })}>
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
      <TextActionDialog
        open={!!decide}
        title={decide?.decision === 'APPROVE' ? 'Approve correction' : 'Reject correction'}
        body="The original record is never modified. The decision is stored with the correction and in the audit trail."
        label="Decision note"
        minLength={3}
        confirmLabel={decide?.decision === 'APPROVE' ? 'Approve' : 'Reject'}
        onCancel={() => setDecide(null)}
        onConfirm={async (note) => {
          if (!decide) return;
          await send(`/api/v1/corrections/${decide.c.id}/decide`, 'POST', { decision: decide.decision, note }).catch((e) => {
            throw new Error(errorText(e));
          });
          setNotice({ ok: true, text: 'Decision recorded.' });
          setDecide(null);
          await list.reload();
        }}
      />
    </>
  );
}
