import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorText, send } from '../services/api';
import type { Conflict, DutyCategory, DutyDetail, Page, PersonnelItem } from '../services/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/ui/Misc';
import { LoadingState } from '../components/ui/States';
import { CategoryBadge, ClassText, Field, Notice, UnitSelect, fromLocalInput, toLocalInput } from '../components/ops/Ops';
import { t, tCode } from '../i18n';

const CATS: DutyCategory[] = ['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'];

function nextHour(offsetH: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetH);
  return toLocalInput(d);
}

/** Create a duty (all four categories) or edit the details/schedule of an existing one. */
export function DutyFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [loaded, setLoaded] = useState(!editing);
  const [status, setStatus] = useState<string>('DRAFT');
  const [category, setCategory] = useState<DutyCategory>((search.get('category') as DutyCategory) || 'TRAIN_BEAT');
  const [title, setTitle] = useState('');
  const [unitId, setUnitId] = useState('');
  const [start, setStart] = useState(nextHour(1));
  const [end, setEnd] = useState(nextHour(9));
  const [reportingLocation, setReportingLocation] = useState('');
  const [trainRef, setTrainRef] = useState('');
  const [stationUnitId, setStationUnitId] = useState('');
  const [escortLabel, setEscortLabel] = useState('');
  const [incidentRef, setIncidentRef] = useState('');
  const [supervisorOfficerId, setSupervisorOfficerId] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [publish, setPublish] = useState(false);
  const [people, setPeople] = useState<PersonnelItem[]>([]);
  const [selected, setSelected] = useState<Record<string, 'LEAD' | 'MEMBER'>>({});
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Page<PersonnelItem>>('/api/v1/personnel?status=ACTIVE&pageSize=100')
      .then((r) => setPeople(r.items))
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    if (!editing) return;
    void api<DutyDetail>(`/api/v1/duty-assignments/${id}`).then((d) => {
      setStatus(d.status);
      setCategory(d.category);
      setTitle(d.title);
      setUnitId(d.unitId);
      setStart(toLocalInput(d.plannedStart));
      setEnd(toLocalInput(d.plannedEnd));
      setReportingLocation(d.reportingLocation ?? '');
      setTrainRef(d.trainRef ?? '');
      setStationUnitId(d.stationUnitId ?? '');
      setEscortLabel(d.escortLabel ?? '');
      setIncidentRef(d.incidentRef ?? '');
      setSupervisorOfficerId(d.supervisorOfficerId ?? '');
      setNotes(d.notes ?? '');
      setLoaded(true);
    });
  }, [editing, id]);

  const supervisors = people.filter((p) => ['HC', 'ASI', 'SI', 'CI', 'DSP'].includes(p.rank ?? ''));
  const visiblePeople = useMemo(
    () =>
      people.filter((p) =>
        `${p.displayName} ${p.personnelRef} ${tCode('class', p.personnelClass)}`.toLowerCase().includes(filter.toLowerCase()),
      ),
    [people, filter],
  );

  async function submit(e: FormEvent, override = false) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const common = {
      title,
      plannedStart: fromLocalInput(start),
      plannedEnd: fromLocalInput(end),
      reportingLocation: reportingLocation || null,
      trainRef: category === 'TRAIN_BEAT' ? trainRef || null : null,
      stationUnitId: category === 'STATION_WATCH' ? stationUnitId || null : null,
      escortLabel: category === 'VIP_ESCORT' ? escortLabel || null : null,
      incidentRef: category === 'TRACK_INCIDENT' ? incidentRef || null : null,
      supervisorOfficerId: supervisorOfficerId || null,
      notes: notes || null,
    };
    try {
      if (editing) {
        await send(`/api/v1/duty-assignments/${id}`, 'PATCH', {
          ...common,
          reason: reason || undefined,
          ...(override ? { allowConflict: true } : {}),
        });
        navigate(`/duties/${id}`);
      } else {
        const r = await send<DutyDetail>('/api/v1/duty-assignments', 'POST', {
          category,
          unitId,
          ...common,
          personnel: Object.entries(selected).map(([officerId, roleInDuty]) => ({ officerId, roleInDuty })),
          publish,
          ...(override ? { allowConflict: true, overrideReason } : {}),
        });
        navigate(`/duties/${r.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ASSIGNMENT_CONFLICT')
        setConflicts((err.details as { conflicts: Conflict[] }).conflicts);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <LoadingState />;
  return (
    <>
      <PageHeader
        title={editing ? 'Edit duty' : t('duty.new')}
        subtitle={
          editing
            ? 'Changes to a published duty need a reason and are kept in the duty history. Personnel are managed on the duty page.'
            : 'Staffing is flexible: assign one or more eligible personnel in any combination allowed by the configured policy.'
        }
        actions={<Link className="btn-secondary" to={editing ? `/duties/${id}` : '/duties'}>{t('common.cancel')}</Link>}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      {conflicts && (
        <div className="mb-4 rounded-lg border border-signal-warn/40 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-signal-warn">Conflicts detected</p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={`${c.type}-${c.id}`}>{c.detail}</li>
            ))}
          </ul>
          {can('duty.approve') ? (
            <div className="mt-3">
              <Field label="Override reason (recorded and flagged for review)">
                <input className="input w-full" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} minLength={5} />
              </Field>
              <button
                type="button"
                className="btn-primary mt-2"
                disabled={busy || overrideReason.trim().length < 5}
                onClick={(e) => void submit(e as unknown as FormEvent, true)}
              >
                Save despite conflict
              </button>
            </div>
          ) : (
            <p className="mt-2 text-ink-800">Overriding a conflict requires the duty.approve permission.</p>
          )}
        </div>
      )}
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-lg border border-paper-200 bg-white p-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('duty.category')}>
              <select className="input w-full" value={category} disabled={editing} onChange={(e) => setCategory(e.target.value as DutyCategory)}>
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {tCode('category', c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('duty.unit')} hint="Must be within your configured scope.">
              {editing ? (
                <input className="input w-full" disabled value="(unchanged)" />
              ) : (
                <UnitSelect value={unitId} onChange={setUnitId} allowAll={false} />
              )}
            </Field>
          </div>
          <Field label={t('duty.title')}>
            <input className="input w-full" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Planned start">
              <input type="datetime-local" className="input w-full" required value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Planned end">
              <input type="datetime-local" className="input w-full" required value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <Field label="Reporting location" hint="Use synthetic or generic descriptions in demonstrations.">
            <input className="input w-full" maxLength={160} value={reportingLocation} onChange={(e) => setReportingLocation(e.target.value)} />
          </Field>
          {category === 'TRAIN_BEAT' && (
            <Field label="Train / service reference (if available)">
              <input className="input w-full" maxLength={60} value={trainRef} onChange={(e) => setTrainRef(e.target.value)} placeholder="e.g. DEMO-TRN-101" />
            </Field>
          )}
          {category === 'STATION_WATCH' && (
            <Field label="Station">
              <UnitSelect value={stationUnitId} onChange={setStationUnitId} allowAll={false} types={['STATION']} />
            </Field>
          )}
          {category === 'VIP_ESCORT' && (
            <Field label="Escort label (synthetic only — never a real itinerary or person)">
              <input className="input w-full" required maxLength={80} value={escortLabel} onChange={(e) => setEscortLabel(e.target.value)} placeholder="DEMO-VIP-…" />
            </Field>
          )}
          {category === 'TRACK_INCIDENT' && (
            <Field label="Incident reference (fictional in demos — never a real case number)">
              <input className="input w-full" required maxLength={60} value={incidentRef} onChange={(e) => setIncidentRef(e.target.value)} placeholder="DEMO-INC-…" />
            </Field>
          )}
          <Field label="Supervising officer (optional)">
            <select className="input w-full" value={supervisorOfficerId} onChange={(e) => setSupervisorOfficerId(e.target.value)}>
              <option value="">—</option>
              {supervisors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} · {tCode('class', p.personnelClass)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea className="input h-20 w-full" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {editing && status !== 'DRAFT' && (
            <Field label={`${t('common.reason')} (required for a published duty)`}>
              <input className="input w-full" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </section>
        {!editing && (
          <section className="rounded-lg border border-paper-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-700">{t('duty.personnel')}</h2>
              <CategoryBadge category={category} />
            </div>
            {can('duty.assign') ? (
              <>
                <input type="search" className="input mb-2 w-full" placeholder="Filter by name, ID or class" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter personnel" />
                <ul className="max-h-[22rem] space-y-1 overflow-y-auto text-sm">
                  {visiblePeople.map((p) => {
                    const sel = selected[p.id];
                    return (
                      <li key={p.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-paper-50">
                        <input
                          type="checkbox"
                          id={`p-${p.id}`}
                          checked={!!sel}
                          onChange={(e) =>
                            setSelected((s) => {
                              const n = { ...s };
                              if (e.target.checked) n[p.id] = 'MEMBER';
                              else delete n[p.id];
                              return n;
                            })
                          }
                        />
                        <label htmlFor={`p-${p.id}`} className="min-w-0 flex-1">
                          <span className="block truncate">{p.displayName}</span>
                          <span className="block text-xs text-ink-700">
                            <ClassText cls={p.personnelClass} /> · {p.unitName}
                          </span>
                        </label>
                        {sel && (
                          <select
                            aria-label={`Role of ${p.displayName}`}
                            className="input py-0.5 text-xs"
                            value={sel}
                            onChange={(e) => setSelected((s) => ({ ...s, [p.id]: e.target.value as 'LEAD' | 'MEMBER' }))}
                          >
                            <option value="MEMBER">Member</option>
                            <option value="LEAD">Lead</option>
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-ink-700">{Object.keys(selected).length} selected. No fixed AR/General combination is required.</p>
              </>
            ) : (
              <p className="text-sm text-ink-700">You can create a draft; assigning personnel requires duty.assign.</p>
            )}
            {can('duty.approve') && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                Publish immediately (personnel are notified)
              </label>
            )}
          </section>
        )}
        <div className="lg:col-span-3">
          <button type="submit" className="btn-primary" disabled={busy || (!editing && !unitId)}>
            {busy ? 'Saving…' : editing ? t('common.save') : publish ? 'Create and publish' : 'Create draft'}
          </button>
        </div>
      </form>
    </>
  );
}
