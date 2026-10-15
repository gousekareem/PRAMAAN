import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { DutyCategory, Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { PageHeader, Pagination, TimeText } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';
import { CategoryBadge, Disclaimer, Field } from '../components/ops/Ops';
import { t, tCode } from '../i18n';

interface CheckinRow {
  checkinId: string;
  officerId: string;
  officerName: string;
  isDemo: boolean;
  dutySessionId: string | null;
  assignmentId: string | null;
  dutyReference: string | null;
  dutyCategory: DutyCategory | null;
  scheduledForDevice: string | null;
  deadlineDevice: string | null;
  status: string;
  biometricResult: string | null;
  challengeResult: string | null;
  responseMs: number | null;
  lateByMs: number | null;
  missedReason: string | null;
  serverReceivedAt: string | null;
  location: {
    latitude: number;
    longitude: number;
    horizontalAccuracyM: number | null;
    spatialResult: string;
    mockIndicator: boolean | null;
    recordedDeviceTime: string;
    eventType: string;
  } | null;
  corrections: number;
  approvedStatusCorrection: string | null;
}

export function CheckinsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const list = useApi(
    () => api<Page<CheckinRow>>(`/api/v1/checkins${qs({ page, pageSize: 25, status, category })}`),
    [page, status, category],
  );
  useRefreshOnChange(list.reload);
  return (
    <>
      <PageHeader title={t('checkins.title')} subtitle={t('checkins.subtitle')} />
      <Disclaimer>
        A check-in shows that the enrolled device completed the biometric step and the cognitive code in time. GPS and other
        sensor values are reported by the device and can be wrong or spoofed; they are corroborating signals, not proof of
        physical presence. Events still queued on an offline device appear only after it synchronises.
      </Disclaimer>
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-paper-200 bg-white p-3 md:grid-cols-4">
        <Field label={t('duty.status')}>
          <select className="input w-full" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="EXCEPTIONS">Missed or late only</option>
            {['ACKNOWLEDGED', 'ACKNOWLEDGED_LATE', 'MISSED', 'SCHEDULED', 'PRESENTED'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('duty.category')}>
          <select className="input w-full" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {(['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'] as const).map((c) => (
              <option key={c} value={c}>
                {tCode('category', c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.items.length && (
        <EmptyState title="No check-ins synchronised yet." hint="Check-ins appear after a duty device synchronises its signed events." />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person / duty</th>
                  <th scope="col">Status</th>
                  <th scope="col">Times</th>
                  <th scope="col">Location provenance</th>
                  <th scope="col">Response</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((k) => (
                  <tr key={k.checkinId}>
                    <td>
                      <Link to={`/personnel/${k.officerId}`} className="font-medium hover:underline">
                        {k.officerName}
                      </Link>{' '}
                      <DemoBadge show={k.isDemo} />
                      {k.assignmentId ? (
                        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                          <Link to={`/duties/${k.assignmentId}`} className="font-mono underline">
                            {k.dutyReference}
                          </Link>
                          {k.dutyCategory && <CategoryBadge category={k.dutyCategory} />}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-700">Individual session (no duty assignment)</p>
                      )}
                    </td>
                    <td className="text-xs">
                      <StatusBadge value={k.status} />
                      {k.missedReason && <p className="mt-1">Reason: {k.missedReason.toLowerCase().replace(/_/g, ' ')}</p>}
                      {k.approvedStatusCorrection && (
                        <p className="mt-1 text-signal-info">Approved correction: {String(k.approvedStatusCorrection)} (original kept)</p>
                      )}
                      {k.corrections > 0 && !k.approvedStatusCorrection && <p className="mt-1 text-ink-700">{k.corrections} correction request(s)</p>}
                    </td>
                    <td className="text-xs">
                      Scheduled: <TimeText iso={k.scheduledForDevice} source="device" />
                      <br />
                      Received: <TimeText iso={k.serverReceivedAt} source="server" />
                    </td>
                    <td className="text-xs">
                      {k.location ? (
                        <>
                          {k.location.latitude.toFixed(5)}, {k.location.longitude.toFixed(5)} · ±{k.location.horizontalAccuracyM ?? '?'} m
                          <br />
                          <StatusBadge value={k.location.spatialResult} />
                          {k.location.mockIndicator && <span className="ml-1 text-signal-bad">mock-location indicator</span>}
                          <br />
                          <span className="text-ink-600">from {k.location.eventType.toLowerCase().replace(/_/g, ' ')} (device-reported)</span>
                        </>
                      ) : (
                        <span className="text-ink-600">No location reported with this check-in</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      Biometric: {k.biometricResult?.toLowerCase() ?? '—'}
                      <br />
                      Code: {k.challengeResult?.toLowerCase() ?? '—'}
                      {k.responseMs !== null && <br />}
                      {k.responseMs !== null && `${Math.round(k.responseMs / 1000)} s`}
                      {k.lateByMs ? ` · late ${Math.round(k.lateByMs / 60000)} min` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
