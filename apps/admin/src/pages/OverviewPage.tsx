import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { DutyCategory, Flag, Page, Summary } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { Card, PageHeader, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState, EmptyState } from '../components/ui/States';
import { Badge, DemoBadge, StatusBadge } from '../components/ui/Badges';
import { CATEGORY_STYLE, Field, UnitSelect } from '../components/ops/Ops';
import { FLAG_LABELS } from './AlertsPage';
import { tCode } from '../i18n';

interface Operations {
  generatedAt: string;
  range: { from: string; to: string };
  scope: { level: string };
  personnel: { cls: string; active: number; inactive: number }[];
  dutiesByCategory: {
    category: DutyCategory;
    total: number;
    completed: number;
    cancelled: number;
    inProgress: number;
    assigned: number;
    draft: number;
    exceptionReported: number;
  }[];
  presence: { acknowledged: number; late: number; missed: number };
  evidence: { verified: number; awaitingUpload: number; failed: number };
  synchronisation: { openSyncFailures: number; rejectedEvents24h: number; lastBatchReceivedAt: string | null };
  openExceptionsByType: { flagType: string; n: number }[];
  assignmentsWithConflicts: number;
  recentAudit: { sequence: number; occurredAt: string; action: string; targetType: string; actorName: string | null }[];
}

function Metric({ label, value, to, tone, hint }: { label: string; value: number | string; to?: string; tone?: 'warn' | 'bad'; hint?: string }) {
  const body = (
    <div className="h-full rounded-lg border border-paper-200 bg-white p-4 shadow-sm transition hover:border-ink-600/40">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-700">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone === 'bad' ? 'text-signal-bad' : tone === 'warn' ? 'text-signal-warn' : 'text-ink-950'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-700">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-600">
      {body}
    </Link>
  ) : (
    body
  );
}

const dateInput = (d: Date) => d.toISOString().slice(0, 10);
const ORDER: DutyCategory[] = ['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'];
const SLUG: Record<DutyCategory, string> = {
  TRAIN_BEAT: 'train-beats',
  STATION_WATCH: 'station-watches',
  VIP_ESCORT: 'vip-escorts',
  TRACK_INCIDENT: 'track-incidents',
};

export function OverviewPage() {
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => dateInput(new Date(Date.now() + 7 * 86_400_000)));
  const [category, setCategory] = useState('');
  const [unitId, setUnitId] = useState('');
  const ops = useApi(
    () =>
      api<Operations>(
        `/api/v1/dashboard/operations${qs({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString(), category, unitId })}`,
      ),
    [from, to, category, unitId],
  );
  const summary = useApi(() => api<Summary>('/api/v1/dashboard/summary'), []);
  const alerts = useApi(() => api<Page<Flag>>('/api/v1/dashboard/alerts?pageSize=6'), []);
  useRefreshOnChange(ops.reload);
  useRefreshOnChange(summary.reload);
  useRefreshOnChange(alerts.reload);
  const o = ops.data;
  const s = summary.data;
  const totals = o?.dutiesByCategory.reduce(
    (a, c) => ({ total: a.total + c.total, completed: a.completed + c.completed, cancelled: a.cancelled + c.cancelled, inProgress: a.inProgress + c.inProgress }),
    { total: 0, completed: 0, cancelled: 0, inProgress: 0 },
  );
  const closable = totals ? totals.total - totals.cancelled : 0;
  const openExceptions = o?.openExceptionsByType.reduce((a, x) => a + x.n, 0) ?? 0;
  const activePersonnel = o?.personnel.reduce((a, x) => a + x.active, 0) ?? 0;
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`All figures are counts of stored records within your scope (${o?.scope.level ?? '…'}). Devices that are offline appear only after they synchronise.`}
      />
      <form className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-paper-200 bg-white p-3 md:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Overview filters">
        <Field label="From">
          <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Duty category">
          <select className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {ORDER.map((c) => (
              <option key={c} value={c}>
                {tCode('category', c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit">
          <UnitSelect value={unitId} onChange={setUnitId} />
        </Field>
      </form>
      {ops.loading && !o && <LoadingState />}
      {ops.error ? <ErrorState error={ops.error} onRetry={ops.reload} /> : null}
      {o && totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Active personnel" value={activePersonnel} to="/personnel" />
          <Metric label="Duties in range" value={totals.total} to="/duties" hint={`${totals.inProgress} in progress`} />
          <Metric
            label="Duties completed"
            value={closable ? `${Math.round((totals.completed / closable) * 100)}%` : '—'}
            hint={`${totals.completed} of ${closable} (excl. cancelled)`}
          />
          <Metric label="Unresolved exceptions" value={openExceptions} to="/alerts" tone={openExceptions ? 'warn' : undefined} />
          <Metric
            label="Missed check-ins"
            value={o.presence.missed}
            to="/checkins"
            tone={o.presence.missed ? 'warn' : undefined}
            hint={`${o.presence.acknowledged} on time · ${o.presence.late} late`}
          />
          <Metric label="Evidence verification failures" value={o.evidence.failed} to="/evidence?status=QUARANTINED" tone={o.evidence.failed ? 'bad' : undefined} hint={`${o.evidence.verified} verified`} />
          <Metric
            label="Pending / failed sync"
            value={`${o.evidence.awaitingUpload} / ${o.synchronisation.openSyncFailures}`}
            hint="evidence awaiting upload / open sync-failure exceptions"
            tone={o.synchronisation.openSyncFailures ? 'warn' : undefined}
          />
          <Metric label="Duties with conflicts" value={o.assignmentsWithConflicts} to="/roster" tone={o.assignmentsWithConflicts ? 'warn' : undefined} />
        </div>
      )}
      {o && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card title="Duties by category" className="lg:col-span-2">
            {!o.dutiesByCategory.length ? (
              <EmptyState title="No duties in this range." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Total</th>
                    <th scope="col">Status mix</th>
                    <th scope="col">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER.map((cat) => {
                    const c = o.dutiesByCategory.find((x) => x.category === cat);
                    if (!c) return null;
                    const parts: [string, number, string][] = [
                      ['Completed', c.completed, 'bg-ink-700'],
                      ['In progress', c.inProgress, 'bg-signal-ok'],
                      ['Assigned', c.assigned, 'bg-signal-info'],
                      ['Exception', c.exceptionReported, 'bg-signal-warn'],
                      ['Draft', c.draft, 'bg-gray-300'],
                      ['Cancelled', c.cancelled, 'bg-paper-200'],
                    ];
                    return (
                      <tr key={cat}>
                        <td>
                          <Link to={`/duties/category/${SLUG[cat]}`} className="inline-flex items-center gap-2 hover:underline">
                            <span className={`h-2.5 w-2.5 rounded-sm ${CATEGORY_STYLE[cat].dot}`} aria-hidden />
                            {tCode('category', cat)}
                          </Link>
                        </td>
                        <td className="tabular-nums">{c.total}</td>
                        <td className="min-w-[10rem]">
                          <div className="flex h-2.5 w-full overflow-hidden rounded bg-paper-100" role="img" aria-label={parts.map(([l, n]) => `${l} ${n}`).join(', ')}>
                            {parts.map(([l, n, cls]) => (n ? <span key={l} className={cls} style={{ width: `${(n / c.total) * 100}%` }} title={`${l}: ${n}`} /> : null))}
                          </div>
                          <p className="mt-1 text-[11px] text-ink-700">{parts.filter(([, n]) => n).map(([l, n]) => `${l} ${n}`).join(' · ')}</p>
                        </td>
                        <td className="tabular-nums">{c.completed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-ink-700">Completion is a supervisory status; it is not proof of physical attendance.</p>
          </Card>
          <Card title="Personnel by rank & subtype">
            <ul className="space-y-1 text-sm">
              {o.personnel.map((p) => (
                <li key={p.cls} className="flex justify-between gap-2">
                  <span>{tCode('class', p.cls)}</span>
                  <span className="tabular-nums">
                    {p.active}
                    {p.inactive ? <span className="text-ink-600"> (+{p.inactive} inactive)</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Open exceptions by type">
            {!o.openExceptionsByType.length && <p className="text-sm text-ink-700">No unresolved exceptions.</p>}
            <ul className="space-y-1 text-sm">
              {o.openExceptionsByType.map((x) => (
                <li key={x.flagType} className="flex justify-between gap-2">
                  <Link className="hover:underline" to={`/alerts`}>
                    {FLAG_LABELS[x.flagType] ?? x.flagType}
                  </Link>
                  <span className="tabular-nums">{x.n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-700">Exceptions prompt review and are never classified as misconduct automatically.</p>
          </Card>
          <Card title="Highest-priority open exceptions" className="lg:col-span-2">
            {alerts.data && alerts.data.items.length === 0 && <EmptyState title="No open exceptions" />}
            <ul className="divide-y divide-paper-100">
              {alerts.data?.items.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <StatusBadge value={f.severity} />
                  <span className="font-medium">{f.title}</span>
                  <span className="text-ink-700">{f.officerName ?? '—'}</span>
                  {f.dutyReference && <span className="font-mono text-xs text-ink-700">{f.dutyReference}</span>}
                  <DemoBadge show={f.isDemo} />
                  <span className="ml-auto text-xs text-ink-600">{formatTime(f.createdAt)} (server)</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Devices & synchronisation">
            {s ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt>Devices synced (30 min)</dt>
                  <dd className="tabular-nums">
                    {s.devicesSeen30m} / {s.activeDevices}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Devices pending approval</dt>
                  <dd>{s.pendingDevices ? <Badge tone="warn">{s.pendingDevices}</Badge> : 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Rejected events (24 h)</dt>
                  <dd className="tabular-nums">{o.synchronisation.rejectedEvents24h}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Last batch received</dt>
                  <dd className="text-right">{formatTime(o.synchronisation.lastBatchReceivedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Database / PostGIS</dt>
                  <dd>
                    <Badge tone={s.systemHealth.database === 'ok' ? 'ok' : 'bad'}>{s.systemHealth.database}</Badge>
                  </dd>
                </div>
              </dl>
            ) : (
              <LoadingState />
            )}
          </Card>
          {o.recentAudit.length > 0 && (
            <Card title="Recent audit events" className="lg:col-span-3">
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {o.recentAudit.map((a) => (
                  <li key={a.sequence}>
                    #{a.sequence} · {a.action.replace(/_/g, ' ').toLowerCase()} · {a.actorName ?? 'system'} · {formatTime(a.occurredAt)}
                  </li>
                ))}
              </ul>
              <Link to="/audit" className="mt-2 inline-block text-sm underline">
                Audit history
              </Link>
            </Card>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-700">Generated {formatTime(o?.generatedAt)} from stored records.</p>
    </>
  );
}
