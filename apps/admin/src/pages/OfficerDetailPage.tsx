import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Card, KV, PageHeader, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';

interface Detail {
  officer: {
    id: string;
    employeeRef: string;
    displayName: string;
    rank: string;
    station: string;
    isActive: boolean;
    isDemo: boolean;
  };
  currentDuty: {
    id: string;
    plannedStart: string;
    plannedEnd: string;
    status: string;
    deviceStartedAt: string | null;
  } | null;
  devices: {
    id: string;
    label: string;
    status: string;
    platform: string;
    keyHardwareBacked: boolean | null;
    lastSyncAt: string | null;
    appVersion: string | null;
  }[];
  checkins: {
    checkinId: string;
    scheduledFor: string | null;
    deadlineAt: string | null;
    status: string;
    biometricResult: string | null;
    challengeResult: string | null;
    responseMs: number | null;
    lateByMs: number | null;
    missedReason: string | null;
  }[];
  evidence: { evidenceId: string; status: string; createdAt: string; capturedAtDevice: string }[];
  flags: {
    id: string;
    flagType: string;
    severity: string;
    status: string;
    title: string;
    createdAt: string;
  }[];
}

export function OfficerDetailPage() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useApi(
    () => api<Detail>(`/api/v1/officers/${id}`),
    [id],
  );
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const o = data.officer;
  return (
    <>
      <PageHeader
        title={o.displayName}
        subtitle={`${o.employeeRef} · ${o.rank.replace('_', ' ')} · ${o.station}`}
        actions={<DemoBadge show={o.isDemo} />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Current duty session">
          {data.currentDuty ? (
            <dl>
              <KV k="Status">
                <StatusBadge value={data.currentDuty.status} />
              </KV>
              <KV k="Planned">
                {formatTime(data.currentDuty.plannedStart)} –{' '}
                {formatTime(data.currentDuty.plannedEnd)}
              </KV>
              <KV k="Device-reported start">
                {formatTime(data.currentDuty.deviceStartedAt)} (device clock)
              </KV>
            </dl>
          ) : (
            <EmptyState title="No planned or active duty" />
          )}
        </Card>
        <Card title="Registered devices">
          {data.devices.length === 0 ? (
            <EmptyState title="No devices registered" />
          ) : (
            <ul className="divide-y divide-paper-100 text-sm">
              {data.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{d.label}</span>
                  <StatusBadge value={d.status} />
                  <span className="text-ink-700">
                    {d.platform}
                    {d.keyHardwareBacked ? ' · hardware-backed key' : ''}
                  </span>
                  <span className="ml-auto text-xs">Last sync {formatTime(d.lastSyncAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Check-in history" className="lg:col-span-2">
          {data.checkins.length === 0 ? (
            <EmptyState title="No check-ins synchronised" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Scheduled (device)</th>
                    <th>Deadline</th>
                    <th>Outcome</th>
                    <th>Biometric</th>
                    <th>Challenge</th>
                    <th>Response / lateness</th>
                  </tr>
                </thead>
                <tbody>
                  {data.checkins.map((c) => (
                    <tr key={c.checkinId}>
                      <td>{formatTime(c.scheduledFor)}</td>
                      <td>{formatTime(c.deadlineAt)}</td>
                      <td>
                        <StatusBadge value={c.status} />
                      </td>
                      <td>{c.biometricResult ?? '—'}</td>
                      <td>{c.challengeResult ?? '—'}</td>
                      <td>
                        {c.responseMs !== null
                          ? `${Math.round(c.responseMs / 1000)} s`
                          : c.lateByMs !== null
                            ? `late by ${Math.round(c.lateByMs / 1000)} s`
                            : (c.missedReason ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Evidence history">
          {data.evidence.length === 0 ? (
            <EmptyState title="No evidence" />
          ) : (
            <ul className="divide-y divide-paper-100 text-sm">
              {data.evidence.map((e) => (
                <li key={e.evidenceId} className="flex items-center gap-2 py-2">
                  <Link to={`/evidence/${e.evidenceId}`} className="font-mono text-xs underline">
                    {e.evidenceId.slice(0, 8)}
                  </Link>
                  <StatusBadge value={e.status} />
                  <span className="ml-auto text-xs">{formatTime(e.capturedAtDevice)} (device)</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Review flags">
          {data.flags.length === 0 ? (
            <EmptyState title="No review flags" />
          ) : (
            <ul className="divide-y divide-paper-100 text-sm">
              {data.flags.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                  <StatusBadge value={f.severity} />
                  <span>{f.title}</span>
                  <StatusBadge value={f.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
