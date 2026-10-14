import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, qs } from '../services/api';
import type { Flag, Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { ConfirmDialog, PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';

export const FLAG_LABELS: Record<string, string> = {
  CHECKIN_MISSED: 'Missed check-in',
  CHECKIN_LATE: 'Late acknowledgment',
  CLOCK_ANOMALY: 'Clock anomaly',
  MOCK_LOCATION_INDICATOR: 'Mock-location indicator',
  EVIDENCE_HASH_MISMATCH: 'Evidence-hash mismatch',
  INVALID_DEVICE_SIGNATURE: 'Invalid device signature',
  SEQUENCE_GAP: 'Sequence gap',
  CHAIN_LINK_MISMATCH: 'Ledger integrity failure',
  EVENT_CONFLICT: 'Conflicting duplicate',
  SPATIAL_ZONE_EXCEPTION: 'Spatial-zone exception',
  MOVEMENT_INCONSISTENCY: 'Movement inconsistency',
  DEVICE_REGISTRATION: 'Device registration',
  DEVICE_REVOCATION: 'Device revocation',
  DEVICE_INTEGRITY: 'Device integrity',
  SCREEN_RECAPTURE_RISK: 'Screen re-capture risk (experimental)',
};

type Action = 'ACKNOWLEDGE' | 'ASSIGN' | 'RESOLVE' | 'DISMISS' | 'REOPEN';

export function AlertsPage() {
  const { hasRole } = useAuth();
  const canAct = hasRole('ADMIN', 'SUPERVISOR');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('ACTIVE');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [pending, setPending] = useState<{ flag: Flag; action: Action } | null>(null);
  const [assignee, setAssignee] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const list = useApi(
    () => api<Page<Flag>>(`/api/v1/dashboard/alerts${qs({ page, status, type, severity })}`),
    [page, status, type, severity],
  );
  const reviewers = useApi(
    () =>
      canAct
        ? api<{ items: { id: string; displayName: string; role: string }[] }>(
            '/api/v1/users/reviewers',
          )
        : Promise.resolve({ items: [] }),
    [canAct],
  );
  useRefreshOnChange(list.reload);

  async function perform(note: string) {
    if (!pending) return;
    try {
      await api(`/api/v1/alerts/${pending.flag.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: pending.action,
          ...(note ? { note } : {}),
          ...(pending.action === 'ASSIGN' ? { assigneeId: assignee } : {}),
        }),
      });
      setNotice({
        ok: true,
        text: `Flag ${pending.action.toLowerCase()}d. The action was recorded in the audit trail.`,
      });
      setPending(null);
      void list.reload();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Action failed.' });
      setPending(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Alerts and review flags"
        subtitle="Each flag records the inputs that produced it. Resolving a flag never changes the original device observation."
      />
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label>
          Status
          <select
            className="input mt-1 block"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="ACTIVE">Active (open / acknowledged / assigned)</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="RESOLVED">Resolved</option>
            <option value="DISMISSED">Dismissed</option>
          </select>
        </label>
        <label>
          Type
          <select
            className="input mt-1 block"
            value={type}
            onChange={(e) => {
              setPage(1);
              setType(e.target.value);
            }}
          >
            <option value="">All types</option>
            {Object.entries(FLAG_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select
            className="input mt-1 block"
            value={severity}
            onChange={(e) => {
              setPage(1);
              setSeverity(e.target.value);
            }}
          >
            <option value="">Any</option>
            <option>HIGH</option>
            <option>MEDIUM</option>
            <option>LOW</option>
            <option>INFO</option>
          </select>
        </label>
      </div>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`mb-3 rounded p-2 text-sm ${notice.ok ? 'bg-emerald-50 text-signal-ok' : 'bg-red-50 text-signal-bad'}`}
        >
          {notice.text}
        </p>
      )}
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title="No flags match the filters" />
      )}
      <ul className="space-y-2">
        {list.data?.items.map((f) => (
          <li key={f.id} className="rounded-lg border border-paper-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={f.severity} />
              <span className="text-xs font-medium uppercase tracking-wide text-ink-700">
                {FLAG_LABELS[f.flagType] ?? f.flagType}
              </span>
              <StatusBadge value={f.status} />
              <DemoBadge show={f.isDemo} />
              <span className="ml-auto text-xs text-ink-600">
                {formatTime(f.createdAt)} (server)
              </span>
            </div>
            <p className="mt-1 font-medium">{f.title}</p>
            <p className="text-sm text-ink-800">{f.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-700">Officer: {f.officerName ?? '—'}</span>
              {f.evidenceId && (
                <Link to={`/evidence/${f.evidenceId}`} className="underline">
                  Evidence
                </Link>
              )}
              {f.assignedToName && (
                <span className="text-ink-700">Assigned to {f.assignedToName}</span>
              )}
              {f.resolutionNote && <span className="text-ink-700">Note: {f.resolutionNote}</span>}
              <button
                type="button"
                className="text-xs underline"
                aria-expanded={expanded === f.id}
                onClick={() => setExpanded(expanded === f.id ? null : f.id)}
              >
                {expanded === f.id ? 'Hide inputs' : 'Show inputs'}
              </button>
              {canAct && (
                <span className="ml-auto flex flex-wrap gap-2">
                  {f.status === 'OPEN' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPending({ flag: f, action: 'ACKNOWLEDGE' })}
                    >
                      Acknowledge
                    </button>
                  )}
                  {!['RESOLVED', 'DISMISSED'].includes(f.status) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPending({ flag: f, action: 'ASSIGN' })}
                    >
                      Assign
                    </button>
                  )}
                  {!['RESOLVED', 'DISMISSED'].includes(f.status) && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setPending({ flag: f, action: 'RESOLVE' })}
                    >
                      Resolve
                    </button>
                  )}
                  {!['RESOLVED', 'DISMISSED'].includes(f.status) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPending({ flag: f, action: 'DISMISS' })}
                    >
                      Dismiss
                    </button>
                  )}
                  {['RESOLVED', 'DISMISSED'].includes(f.status) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPending({ flag: f, action: 'REOPEN' })}
                    >
                      Reopen
                    </button>
                  )}
                </span>
              )}
            </div>
            {expanded === f.id && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-paper-50 p-2 font-mono text-xs">
                {JSON.stringify(f.inputs, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {list.data && (
        <Pagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          onPage={setPage}
        />
      )}
      <ConfirmDialog
        open={!!pending}
        title={
          pending ? `${pending.action.charAt(0)}${pending.action.slice(1).toLowerCase()} flag` : ''
        }
        body="This action will be recorded in the hash-linked audit trail."
        confirmLabel="Confirm"
        requireNote={pending?.action === 'RESOLVE' || pending?.action === 'DISMISS'}
        onCancel={() => setPending(null)}
        onConfirm={perform}
        confirmDisabled={pending?.action === 'ASSIGN' && !assignee}
        extra={
          pending?.action === 'ASSIGN' ? (
            <label className="mt-3 block text-sm font-medium text-ink-900">
              Assignee
              <select
                className="input mt-1 w-full"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Select reviewer…</option>
                {reviewers.data?.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName} ({r.role})
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      />
    </>
  );
}
