import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type { Flag, Page, Summary } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { Card, PageHeader, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState, EmptyState } from '../components/ui/States';
import { Badge, DemoBadge, StatusBadge } from '../components/ui/Badges';

function Metric({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: number | string;
  to?: string;
  tone?: 'warn' | 'bad';
}) {
  const body = (
    <div className="rounded-lg border border-paper-200 bg-white p-4 shadow-sm transition hover:border-ink-600/40">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-700">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${tone === 'bad' ? 'text-signal-bad' : tone === 'warn' ? 'text-signal-warn' : 'text-ink-950'}`}
      >
        {value}
      </p>
    </div>
  );
  return to ? (
    <Link
      to={to}
      className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-600"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function OverviewPage() {
  const summary = useApi(() => api<Summary>('/api/v1/dashboard/summary'), []);
  const alerts = useApi(() => api<Page<Flag>>('/api/v1/dashboard/alerts?pageSize=6'), []);
  useRefreshOnChange(summary.reload);
  useRefreshOnChange(alerts.reload);
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Counts are derived from synchronised device records. Devices that are offline appear only after they reconnect and synchronise."
      />
      {summary.loading && !s && <LoadingState />}
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : null}
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Active duty sessions" value={s.activeDutySessions} to="/duties" />
          <Metric
            label="Devices synced (30 min)"
            value={`${s.devicesSeen30m} / ${s.activeDevices}`}
            to="/devices"
          />
          <Metric
            label="Evidence awaiting upload"
            value={s.evidenceAwaitingUpload}
            to="/evidence"
            tone={s.evidenceAwaitingUpload ? 'warn' : undefined}
          />
          <Metric
            label="Missed check-ins (24 h)"
            value={s.missedCheckins24h}
            to="/alerts"
            tone={s.missedCheckins24h ? 'warn' : undefined}
          />
          <Metric
            label="Open review flags"
            value={s.openFlags}
            to="/alerts"
            tone={s.openFlags ? 'warn' : undefined}
          />
          <Metric
            label="Evidence requiring review"
            value={s.evidenceRequiringReview}
            to="/alerts"
            tone={s.evidenceRequiringReview ? 'bad' : undefined}
          />
          <Metric label="Spatial exceptions" value={s.spatialExceptions} to="/map" />
          <Metric
            label="Devices pending approval"
            value={s.pendingDevices}
            to="/devices"
            tone={s.pendingDevices ? 'warn' : undefined}
          />
        </div>
      )}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Highest-priority open flags" className="lg:col-span-2">
          {alerts.loading && !alerts.data && <LoadingState />}
          {alerts.error ? <ErrorState error={alerts.error} onRetry={alerts.reload} /> : null}
          {alerts.data && alerts.data.items.length === 0 && (
            <EmptyState title="No open review flags" />
          )}
          <ul className="divide-y divide-paper-100">
            {alerts.data?.items.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <StatusBadge value={f.severity} />
                <span className="font-medium">{f.title}</span>
                <span className="text-ink-700">{f.officerName ?? '—'}</span>
                <DemoBadge show={f.isDemo} />
                <span className="ml-auto text-xs text-ink-600">
                  {formatTime(f.createdAt)} (server)
                </span>
              </li>
            ))}
          </ul>
          <Link to="/alerts" className="mt-3 inline-block text-sm text-ink-700 underline">
            All alerts
          </Link>
        </Card>
        <Card title="System health">
          {s ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>API</dt>
                <dd>
                  <Badge tone="ok">{s.systemHealth.api}</Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Database / PostGIS</dt>
                <dd>
                  <Badge tone={s.systemHealth.database === 'ok' ? 'ok' : 'bad'}>
                    {s.systemHealth.database}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Last batch received</dt>
                <dd className="text-right">{formatTime(s.lastBatchReceivedAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Generated</dt>
                <dd className="text-right">{formatTime(s.generatedAt)}</dd>
              </div>
            </dl>
          ) : (
            <LoadingState />
          )}
          <p className="mt-4 text-xs text-ink-700">
            Review flags are prompts for human review. None of them establishes misconduct on its
            own.
          </p>
        </Card>
      </div>
    </>
  );
}
