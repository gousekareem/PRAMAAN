import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, errorText, send } from '../services/api';
import type { Conflict, DutyDetail, DutyStatus, Page, PersonnelItem } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { useAuth } from '../auth/AuthContext';
import { Card, KV, PageHeader, TimeText, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';
import {
  CategoryBadge,
  ClassText,
  Disclaimer,
  DutyStatusBadge,
  Field,
  Notice,
  RestrictedNotice,
  TextActionDialog,
  TimeRange,
  fromLocalInput,
  toLocalInput,
} from '../components/ops/Ops';
import { t, tCode } from '../i18n';

type Dialog =
  | { kind: 'transition'; to: DutyStatus }
  | { kind: 'remove'; personnelId: string; name: string }
  | { kind: 'replace'; personnelId: string; name: string }
  | { kind: 'instructions' }
  | { kind: 'correction'; personnelId: string }
  | null;

const CHANGE_LABEL: Record<string, string> = {
  CREATED: 'Duty created',
  STATUS_CHANGED: 'Status changed',
  PERSONNEL_ADDED: 'Personnel added',
  PERSONNEL_REMOVED: 'Personnel removed',
  PERSONNEL_REPLACED: 'Personnel replaced',
  PERSONNEL_ACCEPTED: 'Assignment accepted',
  SCHEDULE_CHANGED: 'Schedule changed',
  DETAILS_CHANGED: 'Details changed',
  INSTRUCTIONS_PUBLISHED: 'Instructions published',
  HANDOVER_RECORDED: 'Handover recorded',
};

function summarise(v: Record<string, unknown> | null): string {
  if (!v) return '';
  return Object.entries(v)
    .filter(([k]) => !/Id$/.test(k) || k === 'status')
    .map(([k, x]) => `${k}: ${typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) ? formatTime(x) : String(x)}`)
    .join(' · ');
}

export function DutyDetailPage() {
  const { id = '' } = useParams();
  const { can, user } = useAuth();
  const d = useApi(() => api<DutyDetail>(`/api/v1/duty-assignments/${id}`), [id]);
  useRefreshOnChange(d.reload);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [people, setPeople] = useState<PersonnelItem[]>([]);
  const [addOfficer, setAddOfficer] = useState('');
  const [addRole, setAddRole] = useState<'MEMBER' | 'LEAD'>('MEMBER');
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [handover, setHandover] = useState({ outgoing: '', incoming: '', at: toLocalInput(new Date()), tasks: '' });

  useEffect(() => {
    if (!can('duty.assign', 'duty.handover.record')) return;
    void api<Page<PersonnelItem>>('/api/v1/personnel?status=ACTIVE&pageSize=100')
      .then((r) => setPeople(r.items))
      .catch(() => setPeople([]));
  }, [can]);

  const done = async (text: string) => {
    setNotice({ ok: true, text });
    setDialog(null);
    await d.reload();
  };
  const fail = (e: unknown) => setNotice({ ok: false, text: errorText(e) });

  if (d.loading && !d.data) return <LoadingState />;
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data!;
  const active = x.personnelHistory.filter((p) => p.status === 'ASSIGNED' || p.status === 'ACCEPTED');
  const latest = x.instructions[0];
  const iAcked = latest?.acknowledgements.some((a) => a.officerId === user?.officerId);

  async function addPerson(override = false) {
    try {
      const r = await send<{ warnings: string[] }>(`/api/v1/duty-assignments/${id}/personnel`, 'POST', {
        officerId: addOfficer,
        roleInDuty: addRole,
        ...(override ? { allowConflict: true, overrideReason } : {}),
      });
      setConflicts(null);
      setAddOfficer('');
      setOverrideReason('');
      await done(r.warnings.length ? `Assigned with warnings: ${r.warnings.join(' ')}` : 'Personnel assigned.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ASSIGNMENT_CONFLICT') setConflicts((e.details as { conflicts: Conflict[] }).conflicts);
      fail(e);
    }
  }

  return (
    <>
      <PageHeader
        title={`${x.referenceCode}`}
        subtitle={x.title}
        actions={
          <>
            {x.actions.canAccept && (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  send(`/api/v1/duty-assignments/${id}/accept`, 'POST')
                    .then(() => done('Assignment accepted.'))
                    .catch(fail)
                }
              >
                Accept assignment
              </button>
            )}
            {x.actions.canEdit && (
              <Link className="btn-secondary" to={`/duties/${id}/edit`}>
                Edit details / schedule
              </Link>
            )}
            {x.actions.allowedTransitions.map((to) => (
              <button
                key={to}
                type="button"
                className={to === 'CANCELLED' || to === 'EXCEPTION_REPORTED' ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setDialog({ kind: 'transition', to })}
              >
                {tCode('transition', to)}
              </button>
            ))}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryBadge category={x.category} restricted={x.isRestricted} />
        <DutyStatusBadge status={x.status} />
        <DemoBadge show={x.isDemo} />
        <span className="text-sm text-ink-700">
          <TimeRange start={x.plannedStart} end={x.plannedEnd} />
        </span>
      </div>
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {!x.detailsVisible && <div className="mb-4"><RestrictedNotice /></div>}
      {x.warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-signal-warn/40 bg-amber-50 p-3 text-sm" role="status">
          <p className="font-semibold text-signal-warn">Staffing and readiness warnings (not blocking)</p>
          <ul className="mt-1 list-disc pl-5 text-ink-900">
            {x.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <Disclaimer>{t('duty.attendanceDisclaimer')}</Disclaimer>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Duty details" className="lg:col-span-1">
          <dl>
            <KV k="Category" stacked>{tCode('category', x.category)}</KV>
            <KV k="Unit" stacked>{x.unitName}</KV>
            {x.stationName && <KV k="Station" stacked>{x.stationName}</KV>}
            {x.category === 'TRAIN_BEAT' && <KV k="Train / service ref." stacked>{x.trainRef ?? '—'}</KV>}
            {x.category === 'VIP_ESCORT' && <KV k="Escort label" stacked>{x.escortLabel ?? 'Restricted'}</KV>}
            {x.category === 'TRACK_INCIDENT' && <KV k="Incident ref." stacked>{x.incidentRef ?? 'Restricted'}</KV>}
            <KV k="Reporting location" stacked>{x.reportingLocation ?? (x.detailsVisible ? '—' : 'Restricted')}</KV>
            <KV k="Supervising officer" stacked>{x.supervisorName ?? '—'}</KV>
            <KV k="Created by" stacked>{x.createdByName}</KV>
            <KV k="Check-in policy (configured)" stacked>
              every {x.checkinPolicy.minIntervalMin}–{x.checkinPolicy.maxIntervalMin} min · respond within {x.checkinPolicy.responseWindowSec}s · report within{' '}
              {x.checkinPolicy.reportingWindowMin}+{x.checkinPolicy.graceMin} min
            </KV>
            {x.notes && <KV k="Notes" stacked>{x.notes}</KV>}
            {x.completionNote && <KV k="Completion details" stacked>{x.completionNote} ({formatTime(x.completedAt)})</KV>}
            {x.cancelledReason && <KV k="Cancellation reason" stacked>{x.cancelledReason}</KV>}
          </dl>
        </Card>

        <Card title={`Assigned personnel (${active.length})`} className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Assignment</th>
                  <th scope="col">Reported start</th>
                  <th scope="col">Check-ins</th>
                  {x.actions.canAssign && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {x.personnelHistory.map((p) => {
                  const isActive = p.status === 'ASSIGNED' || p.status === 'ACCEPTED';
                  return (
                    <tr key={p.personnelId} className={isActive ? '' : 'opacity-70'}>
                      <td>
                        <Link to={`/personnel/${p.officerId}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-xs text-ink-700">
                          <ClassText cls={p.personnelClass} />
                          {p.roleInDuty === 'LEAD' ? ' · lead' : ''}
                          {!p.isActive && <span className="text-signal-bad"> · inactive</span>}
                        </p>
                      </td>
                      <td className="text-xs">
                        <StatusBadge value={p.status} />
                        {p.removalReason && <p className="mt-1">Reason: {p.removalReason}</p>}
                        {p.conflictOverrideReason && <p className="mt-1 text-signal-warn">Conflict override: {p.conflictOverrideReason}</p>}
                        {p.sessionStatus && <p className="mt-1 text-ink-700">Device session: {p.sessionStatus.toLowerCase()}</p>}
                      </td>
                      <td className="text-xs">
                        {p.deviceReportedStart ? (
                          <>
                            <TimeText iso={p.deviceReportedStart} source="device" />
                            <br />
                            <TimeText iso={p.serverReceivedStart} source="server" />
                          </>
                        ) : (
                          <span className="text-ink-600">Not reported</span>
                        )}
                        {x.myAssignment?.personnelId === p.personnelId && can('correction.request') && (
                          <button type="button" className="mt-1 block text-xs underline" onClick={() => setDialog({ kind: 'correction', personnelId: p.personnelId })}>
                            Request correction
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs tabular-nums">
                        {p.checkinsAcknowledged} ack ({p.checkinsLate} late) · {p.checkinsMissed} missed
                        <br />
                        <span className="text-ink-600">last sync {p.lastDeviceSyncAt ? formatTime(p.lastDeviceSyncAt) : 'never'}</span>
                      </td>
                      {x.actions.canAssign && (
                        <td className="whitespace-nowrap text-xs">
                          {isActive && (
                            <>
                              <button type="button" className="underline" onClick={() => setDialog({ kind: 'replace', personnelId: p.personnelId, name: p.name })}>
                                Replace
                              </button>{' '}
                              ·{' '}
                              <button type="button" className="underline" onClick={() => setDialog({ kind: 'remove', personnelId: p.personnelId, name: p.name })}>
                                Remove
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {x.actions.canAssign && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-paper-100 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addPerson();
              }}
            >
              <Field label="Add personnel" className="min-w-[14rem] flex-1">
                <select className="input w-full" value={addOfficer} onChange={(e) => { setAddOfficer(e.target.value); setConflicts(null); }} required>
                  <option value="">Select…</option>
                  {people
                    .filter((p) => !active.some((a) => a.officerId === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName} · {tCode('class', p.personnelClass)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Role">
                <select className="input" value={addRole} onChange={(e) => setAddRole(e.target.value as 'MEMBER' | 'LEAD')}>
                  <option value="MEMBER">Member</option>
                  <option value="LEAD">Lead</option>
                </select>
              </Field>
              <button type="submit" className="btn-primary" disabled={!addOfficer}>
                Assign
              </button>
            </form>
          )}
          {conflicts && (
            <div className="mt-3 rounded border border-signal-warn/40 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-signal-warn">Conflicts for this person</p>
              <ul className="list-disc pl-5">
                {conflicts.map((c) => (
                  <li key={`${c.type}${c.id}`}>{c.detail}</li>
                ))}
              </ul>
              {x.actions.canOverrideConflicts ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field label="Override reason" className="flex-1">
                    <input className="input w-full" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                  </Field>
                  <button type="button" className="btn-secondary" disabled={overrideReason.trim().length < 5} onClick={() => void addPerson(true)}>
                    Assign despite conflict
                  </button>
                </div>
              ) : (
                <p className="mt-1">You are not authorised to override conflicts.</p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Duty instructions (versioned)">
          {x.actions.canPublishInstructions && (
            <button type="button" className="btn-secondary mb-3" onClick={() => setDialog({ kind: 'instructions' })}>
              Publish new version
            </button>
          )}
          {!x.instructions.length && <p className="text-sm text-ink-700">No instructions published.</p>}
          {x.instructions.map((i, idx) => (
            <article key={i.id} className={`mb-3 rounded border p-3 text-sm ${idx === 0 ? 'border-ink-600/30' : 'border-paper-200 opacity-80'}`}>
              <p className="text-xs text-ink-700">
                Version {i.version} {idx === 0 ? '(current)' : '(superseded)'} · {i.publishedByName} · {formatTime(i.publishedAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{i.body ?? <em className="text-ink-700">Restricted</em>}</p>
              <p className="mt-1 text-xs text-ink-700">
                Acknowledged by: {i.acknowledgements.length ? i.acknowledgements.map((a) => `${a.name} (${formatTime(a.acknowledgedAt)})`).join(', ') : 'nobody yet'}
              </p>
            </article>
          ))}
          {latest && x.myAssignment && !iAcked && (
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                send(`/api/v1/duty-assignments/instructions/${latest.id}/acknowledge`, 'POST')
                  .then(() => done('Instructions acknowledged.'))
                  .catch(fail)
              }
            >
              Acknowledge version {latest.version}
            </button>
          )}
        </Card>

        <Card title="Handovers">
          {!x.handovers.length && <p className="text-sm text-ink-700">No handover recorded.</p>}
          <ul className="space-y-2 text-sm">
            {x.handovers.map((hv) => {
              const mine = user?.officerId === hv.outgoingOfficerId || user?.officerId === hv.incomingOfficerId;
              const myAck = user?.officerId === hv.outgoingOfficerId ? hv.outgoingAckAt : hv.incomingAckAt;
              return (
                <li key={hv.id} className="rounded border border-paper-200 p-2">
                  <p>
                    <strong>{hv.outgoingName}</strong> → <strong>{hv.incomingName}</strong> at {formatTime(hv.handoverAt)}
                  </p>
                  {hv.outstandingTasks && <p className="text-ink-800">Outstanding: {hv.outstandingTasks}</p>}
                  <p className="text-xs text-ink-700">
                    Outgoing ack: {hv.outgoingAckAt ? formatTime(hv.outgoingAckAt) : 'pending'} · Incoming ack:{' '}
                    {hv.incomingAckAt ? formatTime(hv.incomingAckAt) : 'pending'} · recorded by {hv.recordedByName}
                  </p>
                  {mine && !myAck && (
                    <button
                      type="button"
                      className="btn-secondary mt-1"
                      onClick={() =>
                        send(`/api/v1/duty-assignments/handovers/${hv.id}/acknowledge`, 'POST')
                          .then(() => done('Handover acknowledged.'))
                          .catch(fail)
                      }
                    >
                      Acknowledge handover
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {x.actions.canRecordHandover && (
            <form
              className="mt-3 grid gap-2 border-t border-paper-100 pt-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(`/api/v1/duty-assignments/${id}/handovers`, 'POST', {
                  outgoingOfficerId: handover.outgoing || user?.officerId,
                  incomingOfficerId: handover.incoming,
                  handoverAt: fromLocalInput(handover.at),
                  outstandingTasks: handover.tasks || undefined,
                })
                  .then((r) => done(`Handover recorded.${(r as { warnings: string[] }).warnings.length ? ` ${(r as { warnings: string[] }).warnings.join(' ')}` : ''}`))
                  .catch(fail);
              }}
            >
              <Field label="Outgoing">
                <select className="input w-full" value={handover.outgoing} onChange={(e) => setHandover({ ...handover, outgoing: e.target.value })} required={can('duty.handover.record')}>
                  <option value="">{can('duty.handover.record') ? 'Select…' : 'Me'}</option>
                  {active.map((p) => (
                    <option key={p.officerId} value={p.officerId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Incoming">
                <select className="input w-full" value={handover.incoming} onChange={(e) => setHandover({ ...handover, incoming: e.target.value })} required>
                  <option value="">Select…</option>
                  {(people.length ? people.map((p) => ({ id: p.id, name: p.displayName })) : active.map((p) => ({ id: p.officerId, name: p.name }))).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Handover time">
                <input type="datetime-local" className="input w-full" value={handover.at} onChange={(e) => setHandover({ ...handover, at: e.target.value })} required />
              </Field>
              <Field label="Outstanding tasks">
                <input className="input w-full" maxLength={2000} value={handover.tasks} onChange={(e) => setHandover({ ...handover, tasks: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <button type="submit" className="btn-secondary">
                  Record handover
                </button>
              </div>
            </form>
          )}
        </Card>

        <Card title={`Evidence (${x.evidence.length})`}>
          {!x.evidence.length && <p className="text-sm text-ink-700">No evidence captured for this duty yet.</p>}
          <ul className="space-y-1 text-sm">
            {x.evidence.map((e) => (
              <li key={e.evidenceId} className="flex flex-wrap items-center gap-2">
                <Link to={`/evidence/${e.evidenceId}`} className="font-mono text-xs underline">
                  {e.evidenceId.slice(0, 8)}…
                </Link>
                <StatusBadge value={e.status} />
                <span className="text-xs text-ink-700">
                  {e.officerName} · {formatTime(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Exceptions (${x.exceptions.length})`}>
          {!x.exceptions.length && <p className="text-sm text-ink-700">No exceptions linked to this duty.</p>}
          <ul className="space-y-1 text-sm">
            {x.exceptions.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge value={f.severity} /> <StatusBadge value={f.status} />
                <span>{f.title}</span>
                <span className="text-xs text-ink-700">
                  {f.officerName ?? ''} · {formatTime(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          {can('exception.view') && x.exceptions.length > 0 && (
            <Link className="mt-2 inline-block text-sm underline" to={`/alerts?assignmentId=${id}`}>
              Review in Exceptions
            </Link>
          )}
        </Card>
      </div>

      <Card title="Assignment history (append-only)" className="mt-4">
        <ol className="relative space-y-3 border-l border-paper-200 pl-4 text-sm">
          {x.changes.map((c) => (
            <li key={c.id}>
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-ink-600" aria-hidden />
              <p>
                <strong>{CHANGE_LABEL[c.changeType] ?? c.changeType}</strong> · {c.actorName} · {formatTime(c.occurredAt)}
              </p>
              {(c.before || c.after) && (
                <p className="text-xs text-ink-700">
                  {c.before ? `Before: ${summarise(c.before)}. ` : ''}
                  {c.after ? `After: ${summarise(c.after)}` : ''}
                </p>
              )}
              {c.reason && <p className="text-xs text-ink-800">Reason: {c.reason}</p>}
            </li>
          ))}
        </ol>
      </Card>

      <TextActionDialog
        open={dialog?.kind === 'transition'}
        title={dialog?.kind === 'transition' ? tCode('transition', dialog.to) : ''}
        body={
          dialog?.kind === 'transition' && dialog.to === 'COMPLETED'
            ? 'Record completion details. Completion is a supervisory record and does not by itself prove attendance.'
            : dialog?.kind === 'transition' && dialog.to === 'ASSIGNED'
              ? 'Assigned personnel will be notified and the duty will appear on their devices.'
              : dialog?.kind === 'transition' && dialog.to === 'EXCEPTION_REPORTED'
                ? 'Describe the exception. It will be raised for supervisory review — it is not a finding of misconduct.'
                : undefined
        }
        label={dialog?.kind === 'transition' && dialog.to === 'COMPLETED' ? 'Completion details' : t('common.reason')}
        optional={dialog?.kind === 'transition' && (dialog.to === 'ASSIGNED' || dialog.to === 'IN_PROGRESS')}
        danger={dialog?.kind === 'transition' && dialog.to === 'CANCELLED'}
        confirmLabel={dialog?.kind === 'transition' ? tCode('transition', dialog.to) : ''}
        onCancel={() => setDialog(null)}
        onConfirm={async (text) => {
          if (dialog?.kind !== 'transition') return;
          await send(`/api/v1/duty-assignments/${id}/status`, 'POST', {
            to: dialog.to,
            ...(dialog.to === 'COMPLETED' ? { completionNote: text } : text ? { reason: text } : {}),
          });
          await done(`Status changed to ${tCode('status', dialog.to)}.`);
        }}
      />
      <TextActionDialog
        open={dialog?.kind === 'remove'}
        title={dialog?.kind === 'remove' ? `Remove ${dialog.name}` : ''}
        body="The original assignment remains in the history with your reason."
        label={t('common.reason')}
        confirmLabel="Remove from duty"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={async (text) => {
          if (dialog?.kind !== 'remove') return;
          await send(`/api/v1/duty-assignments/${id}/personnel/${dialog.personnelId}/remove`, 'POST', { reason: text });
          await done('Personnel removed; history preserved.');
        }}
      />
      <TextActionDialog
        open={dialog?.kind === 'replace'}
        title={dialog?.kind === 'replace' ? `Replace ${dialog.name}` : ''}
        body="Choose the replacement. Conflicts are checked; the original assignment is kept as REPLACED."
        label={t('common.reason')}
        confirmLabel="Replace"
        onCancel={() => setDialog(null)}
        onConfirm={async (text) => {
          if (dialog?.kind !== 'replace') return;
          await send(`/api/v1/duty-assignments/${id}/personnel/${dialog.personnelId}/replace`, 'POST', { officerId: replaceWith, reason: text });
          setReplaceWith('');
          await done('Replacement recorded.');
        }}
      >
        <Field label="Replacement">
          <select className="input w-full" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} required>
            <option value="">Select…</option>
            {people
              .filter((p) => !active.some((a) => a.officerId === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} · {tCode('class', p.personnelClass)}
                </option>
              ))}
          </select>
        </Field>
      </TextActionDialog>
      <TextActionDialog
        open={dialog?.kind === 'instructions'}
        title="Publish duty instructions"
        body="A new version supersedes the previous one; earlier versions and acknowledgements are kept."
        label="Instructions"
        minLength={3}
        confirmLabel="Publish"
        onCancel={() => setDialog(null)}
        onConfirm={async (text) => {
          await send(`/api/v1/duty-assignments/${id}/instructions`, 'POST', { body: text });
          await done('Instructions published.');
        }}
      />
      <CorrectionDialog
        personnelId={dialog?.kind === 'correction' ? dialog.personnelId : null}
        onClose={() => setDialog(null)}
        onDone={() => done('Correction requested; it needs approval by an authorised supervisor.')}
      />
    </>
  );
}

function CorrectionDialog({ personnelId, onClose, onDone }: { personnelId: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [value, setValue] = useState(toLocalInput(new Date()));
  return (
    <TextActionDialog
      open={!!personnelId}
      title="Request correction of reported start"
      body="The original device-reported value is kept. Your correction is stored separately and must be approved by someone else."
      label={t('common.reason')}
      confirmLabel="Submit request"
      onCancel={onClose}
      onConfirm={async (reason) => {
        await send('/api/v1/corrections', 'POST', {
          targetType: 'DUTY_PERSONNEL',
          targetId: personnelId,
          fieldName: 'reported_start',
          correctedValue: fromLocalInput(value),
          reason,
        });
        await onDone();
      }}
    >
      <Field label="Corrected start time">
        <input type="datetime-local" className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </TextActionDialog>
  );
}
