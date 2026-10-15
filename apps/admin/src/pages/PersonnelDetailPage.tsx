import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText, send } from '../services/api';
import type { DutyCategory, DutyStatus, PersonnelItem } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, KV, PageHeader, TimeText, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge, StatusBadge } from '../components/ui/Badges';
import {
  CategoryBadge,
  ClassText,
  DutyStatusBadge,
  Field,
  Notice,
  TextActionDialog,
  TimeRange,
  UnitSelect,
  fromLocalInput,
  toLocalInput,
} from '../components/ops/Ops';
import { tCode } from '../i18n';

interface Detail {
  profile: PersonnelItem & { createdAt: string; updatedAt: string; unitCode: string | null };
  account: { id: string; email: string; role: string; roleLabel: string; isActive: boolean; isDemo: boolean; lastLoginAt: string | null } | null;
  dutyHistory: {
    id: string;
    referenceCode: string;
    category: DutyCategory;
    title: string;
    plannedStart: string;
    plannedEnd: string;
    dutyStatus: DutyStatus;
    personnelStatus: string;
    roleInDuty: string;
    personnelClass: string;
    removalReason: string | null;
    deviceReportedStart: string | null;
    serverReceivedStart: string | null;
    checkinsAcknowledged: number;
    checkinsMissed: number;
  }[];
  checkins: { checkinId: string; scheduledFor: string | null; status: string; responseMs: number | null; lateByMs: number | null; missedReason: string | null }[];
  unavailability: { id: string; startsAt: string; endsAt: string; category: string; note: string | null; cancelledAt: string | null; recordedByName: string }[];
  exceptions: { id: string; flagType: string; severity: string; status: string; title: string; createdAt: string }[];
  adminHistory: { sequence: number; occurredAt: string; action: string; actorName: string | null; details: Record<string, unknown> }[];
}

export function PersonnelDetailPage() {
  const { id = '' } = useParams();
  const { can, user } = useAuth();
  const d = useApi(() => api<Detail>(`/api/v1/personnel/${id}`), [id]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<'status' | 'edit' | null>(null);
  const [edit, setEdit] = useState({ displayName: '', rank: '', constableCategory: '', unitId: '' });
  const [un, setUn] = useState({ startsAt: toLocalInput(new Date()), endsAt: toLocalInput(new Date(Date.now() + 86_400_000)), category: 'LEAVE', note: '' });
  if (d.loading && !d.data) return <LoadingState />;
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data!;
  const p = x.profile;
  const self = user?.officerId === p.id;
  const manage = can('personnel.manage') && !self;
  const ok = async (text: string) => {
    setNotice({ ok: true, text });
    setDialog(null);
    await d.reload();
  };
  return (
    <>
      <PageHeader
        title={p.displayName}
        subtitle={`${p.personnelRef} · ${tCode('class', p.personnelClass)} · ${p.unitName ?? 'No unit'}`}
        actions={
          <>
            {manage && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEdit({ displayName: p.displayName, rank: p.rank ?? '', constableCategory: p.constableCategory ?? '', unitId: p.unitId ?? '' });
                  setDialog('edit');
                }}
              >
                Edit record
              </button>
            )}
            {manage && (
              <button type="button" className={p.isActive ? 'btn-danger' : 'btn-primary'} onClick={() => setDialog('status')}>
                {p.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            {can('device.view', 'evidence.view') && (
              <Link className="btn-secondary" to={`/officers/${p.id}`}>
                Devices & evidence
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {p.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Inactive</Badge>}
        <DemoBadge show={p.isDemo} />
      </div>
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl>
            <KV k="Personnel ID" stacked>
              <span className="font-mono">{p.personnelRef}</span>
            </KV>
            <KV k="Personnel category" stacked>{p.personnelCategory === 'HOME_GUARD' ? 'Home Guard (separate category)' : 'Police'}</KV>
            <KV k="Rank" stacked>{p.rank ? tCode('class', p.rank) : '— (not in the rank hierarchy)'}</KV>
            {p.rank === 'PC' && <KV k="Constable subtype" stacked>{p.constableCategory ?? 'Not recorded'}</KV>}
            <KV k="Classification" stacked>
              <ClassText cls={p.personnelClass} />
            </KV>
            <KV k="Unit" stacked>{p.unitName ?? '—'}</KV>
            <KV k="Gender (as supplied)" stacked>{p.gender.replace('_', ' ').toLowerCase()}</KV>
            <KV k="Created / updated" stacked>
              {formatTime(p.createdAt)} / {formatTime(p.updatedAt)}
            </KV>
          </dl>
          {x.account && (
            <div className="mt-3 rounded border border-paper-200 p-2 text-sm">
              <p className="font-medium">Login account</p>
              <p className="text-ink-800">
                {x.account.email} · {x.account.roleLabel} · {x.account.isActive ? 'active' : 'inactive'}
              </p>
              <p className="text-xs text-ink-700">Last sign-in: {formatTime(x.account.lastLoginAt)}</p>
            </div>
          )}
        </Card>
        <Card title="Duty history" className="lg:col-span-2">
          {!x.dutyHistory.length && <p className="text-sm text-ink-700">No duties recorded.</p>}
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Duty</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reported start</th>
                  <th scope="col">Check-ins</th>
                </tr>
              </thead>
              <tbody>
                {x.dutyHistory.map((h) => (
                  <tr key={`${h.id}-${h.personnelStatus}-${h.plannedStart}`}>
                    <td>
                      <Link to={`/duties/${h.id}`} className="font-mono text-xs underline">
                        {h.referenceCode}
                      </Link>
                      <div className="mt-1">
                        <CategoryBadge category={h.category} />
                      </div>
                      <p className="text-xs text-ink-700">{h.title}</p>
                    </td>
                    <td className="text-xs">
                      <TimeRange start={h.plannedStart} end={h.plannedEnd} />
                    </td>
                    <td className="text-xs">
                      <DutyStatusBadge status={h.dutyStatus} />
                      <p className="mt-1">
                        Person: {h.personnelStatus.toLowerCase()}
                        {h.roleInDuty === 'LEAD' ? ' (lead)' : ''}
                      </p>
                      {h.removalReason && <p className="text-ink-700">Reason: {h.removalReason}</p>}
                    </td>
                    <td className="text-xs">
                      {h.deviceReportedStart ? <TimeText iso={h.deviceReportedStart} source="device" /> : <span className="text-ink-600">—</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs tabular-nums">
                      {h.checkinsAcknowledged} ack · {h.checkinsMissed} missed
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Unavailability (generic categories)">
          {!x.unavailability.length && <p className="text-sm text-ink-700">None recorded.</p>}
          <ul className="space-y-2 text-sm">
            {x.unavailability.map((u) => (
              <li key={u.id} className={`rounded border border-paper-200 p-2 ${u.cancelledAt ? 'opacity-60' : ''}`}>
                <p>
                  <strong>{u.category.replace('_', ' ').toLowerCase()}</strong> · <TimeRange start={u.startsAt} end={u.endsAt} />
                </p>
                {u.note && <p className="text-ink-800">{u.note}</p>}
                <p className="text-xs text-ink-700">
                  Recorded by {u.recordedByName}
                  {u.cancelledAt ? ` · cancelled ${formatTime(u.cancelledAt)}` : ''}
                </p>
                {!u.cancelledAt && can('availability.manage') && (
                  <button
                    type="button"
                    className="mt-1 text-xs underline"
                    onClick={() =>
                      send(`/api/v1/personnel/${id}/unavailability/${u.id}/cancel`, 'POST')
                        .then(() => ok('Unavailability cancelled.'))
                        .catch((e) => setNotice({ ok: false, text: errorText(e) }))
                    }
                  >
                    Cancel entry
                  </button>
                )}
              </li>
            ))}
          </ul>
          {can('availability.manage') && (
            <form
              className="mt-3 grid gap-2 border-t border-paper-100 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                send<{ conflicts: unknown[] }>(`/api/v1/personnel/${id}/unavailability`, 'POST', {
                  startsAt: fromLocalInput(un.startsAt),
                  endsAt: fromLocalInput(un.endsAt),
                  category: un.category,
                  note: un.note || undefined,
                })
                  .then((r) => ok(r.conflicts.length ? `Recorded. ${r.conflicts.length} overlapping duty/duties flagged for review.` : 'Unavailability recorded.'))
                  .catch((e) => setNotice({ ok: false, text: errorText(e) }));
              }}
            >
              <Field label="From">
                <input type="datetime-local" className="input w-full" value={un.startsAt} onChange={(e) => setUn({ ...un, startsAt: e.target.value })} />
              </Field>
              <Field label="To">
                <input type="datetime-local" className="input w-full" value={un.endsAt} onChange={(e) => setUn({ ...un, endsAt: e.target.value })} />
              </Field>
              <Field label="Category" hint="Generic labels only; no official leave rules are modelled.">
                <select className="input w-full" value={un.category} onChange={(e) => setUn({ ...un, category: e.target.value })}>
                  {['LEAVE', 'TRAINING', 'COURT_ATTENDANCE', 'MEDICAL', 'OTHER'].map((c) => (
                    <option key={c} value={c}>
                      {c.replace('_', ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note">
                <input className="input w-full" maxLength={300} value={un.note} onChange={(e) => setUn({ ...un, note: e.target.value })} />
              </Field>
              <button type="submit" className="btn-secondary">
                Record unavailability
              </button>
            </form>
          )}
        </Card>
        <Card title="Recent check-ins">
          {!x.checkins.length && <p className="text-sm text-ink-700">No synchronised check-ins.</p>}
          <ul className="space-y-1 text-sm">
            {x.checkins.slice(0, 12).map((k) => (
              <li key={k.checkinId} className="flex flex-wrap items-center gap-2">
                <StatusBadge value={k.status} />
                <span className="text-xs text-ink-700">
                  <TimeText iso={k.scheduledFor} source="device" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Exceptions & administrative history">
          {!x.exceptions.length && <p className="text-sm text-ink-700">No exceptions.</p>}
          <ul className="space-y-1 text-sm">
            {x.exceptions.slice(0, 10).map((f) => (
              <li key={f.id}>
                <StatusBadge value={f.severity} /> {f.title} <span className="text-xs text-ink-700">({f.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
          {x.adminHistory.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-paper-100 pt-2 text-xs text-ink-800">
              {x.adminHistory.map((a) => (
                <li key={a.sequence}>
                  #{a.sequence} {a.action.replace(/_/g, ' ').toLowerCase()} by {a.actorName ?? 'system'} · {formatTime(a.occurredAt)}
                  {typeof a.details.reason === 'string' ? ` — ${a.details.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <TextActionDialog
        open={dialog === 'status'}
        title={p.isActive ? 'Deactivate personnel' : 'Reactivate personnel'}
        body={
          p.isActive
            ? 'The person and linked login account are deactivated and their sessions revoked. Duty, check-in and evidence history is preserved; open assignments are flagged for reassignment.'
            : 'The record and linked login account become active again.'
        }
        label="Reason"
        danger={p.isActive}
        confirmLabel={p.isActive ? 'Deactivate' : 'Reactivate'}
        onCancel={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await send<{ openAssignmentsFlagged: number }>(`/api/v1/personnel/${id}/status`, 'POST', { isActive: !p.isActive, reason });
          await ok(p.isActive ? `Deactivated. ${r.openAssignmentsFlagged} open assignment(s) flagged.` : 'Reactivated.');
        }}
      />
      <TextActionDialog
        open={dialog === 'edit'}
        title="Edit personnel record"
        body="Rank, subtype and unit changes are audited. You cannot edit your own record."
        label="Reason for change"
        confirmLabel="Save changes"
        onCancel={() => setDialog(null)}
        onConfirm={async (reason) => {
          await send(`/api/v1/personnel/${id}`, 'PATCH', {
            displayName: edit.displayName,
            ...(p.personnelCategory === 'POLICE' ? { rank: edit.rank || null, constableCategory: edit.rank === 'PC' ? edit.constableCategory || null : null } : {}),
            unitId: edit.unitId || undefined,
            reason,
          });
          await ok('Record updated.');
        }}
      >
        <div className="grid gap-2">
          <Field label="Display name">
            <input className="input w-full" value={edit.displayName} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />
          </Field>
          {p.personnelCategory === 'POLICE' && (
            <Field label="Rank">
              <select className="input w-full" value={edit.rank} onChange={(e) => setEdit({ ...edit, rank: e.target.value })}>
                {['PC', 'HC', 'ASI', 'SI', 'CI', 'DSP'].map((r) => (
                  <option key={r} value={r}>
                    {tCode('class', r)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {edit.rank === 'PC' && p.personnelCategory === 'POLICE' && (
            <Field label="Constable subtype">
              <select className="input w-full" value={edit.constableCategory} onChange={(e) => setEdit({ ...edit, constableCategory: e.target.value })}>
                <option value="">Not recorded</option>
                <option value="AR">AR</option>
                <option value="GENERAL">General</option>
              </select>
            </Field>
          )}
          <Field label="Unit">
            <UnitSelect value={edit.unitId} onChange={(v) => setEdit({ ...edit, unitId: v })} allowAll={false} />
          </Field>
        </div>
      </TextActionDialog>
    </>
  );
}
