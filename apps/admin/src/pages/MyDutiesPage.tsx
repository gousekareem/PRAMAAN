import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText, send } from '../services/api';
import type { DutyCategory, DutyStatus } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { Card, KV, PageHeader, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge } from '../components/ui/Badges';
import { CategoryBadge, Disclaimer, DutyStatusBadge, Notice, TimeRange } from '../components/ops/Ops';
import { personnelClassOf } from './personnelClass';
import { t, tCode } from '../i18n';

interface Summary {
  personnel: {
    personnelRef: string;
    displayName: string;
    personnelCategory: 'POLICE' | 'HOME_GUARD';
    rank: string | null;
    constableCategory: 'AR' | 'GENERAL' | null;
    unitName: string | null;
  } | null;
  duties: {
    id: string;
    referenceCode: string;
    category: DutyCategory;
    title: string;
    status: DutyStatus;
    plannedStart: string;
    plannedEnd: string;
    reportingLocation: string | null;
    personnelStatus: string;
    acceptRequired: boolean;
    sessionStatus: string | null;
    instructionsVersion: number | null;
    instructionsUnacknowledged: boolean | null;
  }[];
  pendingAcknowledgements: number;
  devices: { id: string; label: string; status: string; lastSyncAt: string | null; lastSequence: number | null }[];
  checkins: { acknowledged: number; late: number; missed: number } | null;
  evidence: { verified: number; awaitingUpload: number; failed: number } | null;
  handovers: { id: string; assignmentId: string; dutyReference: string; handoverAt: string; side: string; acknowledgedAt: string | null }[];
  note: string;
}

/** Personal view for every rank: own duties, instructions to acknowledge, sync status. */
export function MyDutiesPage() {
  const s = useApi(() => api<Summary>('/api/v1/me/summary'), []);
  useRefreshOnChange(s.reload);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  if (s.loading && !s.data) return <LoadingState />;
  if (s.error) return <ErrorState error={s.error} onRetry={s.reload} />;
  const d = s.data!;
  const act = (p: Promise<unknown>, ok: string) =>
    p
      .then(async () => {
        setNotice({ ok: true, text: ok });
        await s.reload();
      })
      .catch((e) => setNotice({ ok: false, text: errorText(e) }));
  return (
    <>
      <PageHeader
        title={t('my.title')}
        subtitle={
          d.personnel
            ? `${d.personnel.displayName} · ${d.personnel.personnelRef} · ${tCode('class', personnelClassOf(d.personnel))} · ${d.personnel.unitName ?? ''}`
            : 'This account is not linked to a personnel record.'
        }
      />
      <Disclaimer>
        Check-ins and evidence are captured in the Android duty app. This page shows what the server has received; anything still queued on
        your device appears after it synchronises.
      </Disclaimer>
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {d.pendingAcknowledgements > 0 && (
        <Notice tone="warn">
          {d.pendingAcknowledgements} duty instruction version{d.pendingAcknowledgements === 1 ? '' : 's'} waiting for your acknowledgement.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Assigned duties" className="lg:col-span-2">
          {!d.duties.length && <EmptyState title="No current or upcoming duties." />}
          <ul className="space-y-3">
            {d.duties.map((x) => (
              <li key={x.id} className="rounded-lg border border-paper-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/duties/${x.id}`} className="font-mono text-sm font-medium underline">
                    {x.referenceCode}
                  </Link>
                  <CategoryBadge category={x.category} />
                  <DutyStatusBadge status={x.status} />
                  <span className="text-sm text-ink-700">
                    <TimeRange start={x.plannedStart} end={x.plannedEnd} />
                  </span>
                </div>
                <p className="mt-1 text-sm">{x.title}</p>
                {x.reportingLocation && <p className="text-xs text-ink-700">Report to: {x.reportingLocation}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {x.acceptRequired && x.personnelStatus === 'ASSIGNED' && (
                    <button type="button" className="btn-primary" onClick={() => act(send(`/api/v1/duty-assignments/${x.id}/accept`, 'POST'), 'Assignment accepted.')}>
                      Accept assignment
                    </button>
                  )}
                  {x.personnelStatus === 'ACCEPTED' && <Badge tone="info">Accepted</Badge>}
                  {x.instructionsVersion && x.instructionsUnacknowledged && (
                    <Link to={`/duties/${x.id}`} className="btn-secondary">
                      Read & acknowledge instructions v{x.instructionsVersion}
                    </Link>
                  )}
                  {x.instructionsVersion && !x.instructionsUnacknowledged && <Badge tone="ok">Instructions v{x.instructionsVersion} acknowledged</Badge>}
                  {x.sessionStatus && <Badge tone="muted">Device session: {x.sessionStatus.toLowerCase()}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Synchronisation status (server view)">
            {!d.devices.length && <p className="text-sm text-ink-700">No registered duty device.</p>}
            {d.devices.map((v) => (
              <dl key={v.id} className="mb-2">
                <KV k="Device" stacked>
                  {v.label} · {v.status.toLowerCase()}
                </KV>
                <KV k="Last synchronised" stacked>{v.lastSyncAt ? formatTime(v.lastSyncAt) : 'never'}</KV>
                <KV k="Server chain head" stacked>{v.lastSequence ? `event #${v.lastSequence}` : '—'}</KV>
              </dl>
            ))}
          </Card>
          <Card title="My check-ins & evidence">
            <dl>
              <KV k="Check-ins acknowledged" stacked>
                {d.checkins?.acknowledged ?? 0} on time · {d.checkins?.late ?? 0} late · {d.checkins?.missed ?? 0} missed
              </KV>
              <KV k="Evidence" stacked>
                {d.evidence?.verified ?? 0} verified · {d.evidence?.awaitingUpload ?? 0} image pending · {d.evidence?.failed ?? 0} failed
              </KV>
            </dl>
            <Link to="/checkins" className="mt-2 inline-block text-sm underline">
              Check-in history
            </Link>
          </Card>
          <Card title="Handovers">
            {!d.handovers.length && <p className="text-sm text-ink-700">No handovers.</p>}
            <ul className="space-y-1 text-sm">
              {d.handovers.map((h) => (
                <li key={h.id}>
                  {h.side.toLowerCase()} · {h.dutyReference} · {formatTime(h.handoverAt)}{' '}
                  {h.acknowledgedAt ? (
                    <Badge tone="ok">acknowledged</Badge>
                  ) : (
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => act(send(`/api/v1/duty-assignments/handovers/${h.id}/acknowledge`, 'POST'), 'Handover acknowledged.')}
                    >
                      Acknowledge
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
