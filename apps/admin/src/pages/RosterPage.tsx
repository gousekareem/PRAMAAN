import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { DutyCategory } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { PageHeader } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { CATEGORY_STYLE, ClassText, Field, UnitSelect } from '../components/ops/Ops';
import { personnelClassOf } from './personnelClass';
import { t, tCode } from '../i18n';

type View = 'day' | 'week' | 'month';

interface RosterDuty {
  officerId: string;
  assignmentId: string;
  referenceCode: string;
  category: DutyCategory;
  status: string;
  personnelStatus: string;
  roleInDuty: string;
  plannedStart: string;
  plannedEnd: string;
  title: string;
}
interface RosterResponse {
  from: string;
  to: string;
  personnel: {
    id: string;
    personnelRef: string;
    displayName: string;
    personnelCategory: 'POLICE' | 'HOME_GUARD';
    rank: string | null;
    constableCategory: 'AR' | 'GENERAL' | null;
    isActive: boolean;
    unitName: string | null;
  }[];
  duties: RosterDuty[];
  unavailability: { id: string; officerId: string; startsAt: string; endsAt: string; category: string }[];
  conflicts: { officerId: string; kind: string; a: string; b: string }[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeFor(view: View, anchor: Date): { from: Date; to: Date; days: Date[] } {
  let from = startOfDay(anchor);
  let n = 1;
  if (view === 'week') {
    const dow = (from.getDay() + 6) % 7; // Monday first
    from = new Date(from.getTime() - dow * 86_400_000);
    n = 7;
  }
  if (view === 'month') {
    from = new Date(from.getFullYear(), from.getMonth(), 1);
    n = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  }
  const days = Array.from({ length: n }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);
  return { from, to, days };
}

const overlaps = (s: string, e: string, d: Date) => new Date(s) < new Date(d.getTime() + 86_400_000) && new Date(e) > d;

export function RosterPage() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [unitId, setUnitId] = useState('');
  const [category, setCategory] = useState('');
  const { from, to, days } = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const r = useApi(
    () =>
      api<RosterResponse>(
        `/api/v1/roster${qs({ from: from.toISOString(), to: to.toISOString(), unitId, category })}`,
      ),
    [from.getTime(), to.getTime(), unitId, category],
  );
  useRefreshOnChange(r.reload);
  const step = (dir: number) => {
    const d = new Date(anchor);
    if (view === 'day') d.setDate(d.getDate() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  };
  const conflictSet = new Set((r.data?.conflicts ?? []).flatMap((c) => [`${c.officerId}:${c.a}`, `${c.officerId}:${c.b}`]));
  const label =
    view === 'month'
      ? from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${days[0]!.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${days[6]!.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
        : from.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  return (
    <>
      <PageHeader title={t('roster.title')} subtitle={t('roster.subtitle')} />
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-paper-200 bg-white p-3">
        <div role="group" aria-label="Roster view" className="flex overflow-hidden rounded border border-paper-200">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm capitalize ${view === v ? 'bg-ink-800 text-white' : 'bg-white text-ink-900 hover:bg-paper-100'}`}
            >
              {v === 'day' ? 'Daily' : v === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary" onClick={() => step(-1)} aria-label="Previous period">
            ‹
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <button type="button" className="btn-secondary" onClick={() => step(1)} aria-label="Next period">
            ›
          </button>
        </div>
        <p className="text-sm font-medium text-ink-900" aria-live="polite">
          {label}
        </p>
        <Field label={t('duty.unit')} className="ml-auto min-w-[12rem]">
          <UnitSelect value={unitId} onChange={setUnitId} />
        </Field>
        <Field label={t('duty.category')}>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {(['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'] as const).map((c) => (
              <option key={c} value={c}>
                {tCode('category', c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-700" aria-label="Legend">
        {(Object.keys(CATEGORY_STYLE) as DutyCategory[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${CATEGORY_STYLE[c].dot}`} aria-hidden /> {tCode('category', c)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-[repeating-linear-gradient(45deg,#d4d0c4_0,#d4d0c4_2px,transparent_2px,transparent_5px)] ring-1 ring-paper-200" aria-hidden />{' '}
          Unavailable
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm ring-2 ring-signal-bad" aria-hidden /> Conflict
        </span>
      </div>
      {r.loading && !r.data && <LoadingState />}
      {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : null}
      {r.data && !r.data.personnel.length && <EmptyState title="No personnel within your scope for these filters." />}
      {r.data && r.data.personnel.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 min-w-[13rem] border-b border-r border-paper-200 bg-paper-100 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-700">
                  Personnel
                </th>
                {days.map((d) => {
                  const today = startOfDay(new Date()).getTime() === d.getTime();
                  return (
                    <th
                      key={d.toISOString()}
                      scope="col"
                      className={`border-b border-paper-200 px-1.5 py-2 text-center text-[11px] font-semibold ${today ? 'bg-amber-50 text-ink-950' : 'bg-paper-100 text-ink-700'} ${view === 'month' ? 'min-w-[2.6rem]' : 'min-w-[7.5rem]'}`}
                    >
                      {d.toLocaleDateString('en-IN', view === 'month' ? { day: '2-digit' } : { weekday: 'short', day: '2-digit', month: 'short' })}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {r.data.personnel.map((p) => {
                const mine = r.data!.duties.filter((d) => d.officerId === p.id);
                const un = r.data!.unavailability.filter((u) => u.officerId === p.id);
                return (
                  <tr key={p.id} className="border-b border-paper-100">
                    <th scope="row" className="sticky left-0 z-10 border-r border-paper-200 bg-white px-3 py-1.5 text-left font-normal">
                      <Link to={`/personnel/${p.id}`} className="font-medium hover:underline">
                        {p.displayName}
                      </Link>
                      <span className="block text-[11px] text-ink-700">
                        <ClassText cls={personnelClassOf(p)} />
                        {!p.isActive && <span className="text-signal-bad"> · inactive</span>}
                      </span>
                    </th>
                    {days.map((d) => {
                      const cell = mine.filter((x) => overlaps(x.plannedStart, x.plannedEnd, d));
                      const off = un.find((u) => overlaps(u.startsAt, u.endsAt, d));
                      return (
                        <td
                          key={d.toISOString()}
                          className={`h-12 border-l border-paper-100 p-1 align-top ${off ? 'bg-[repeating-linear-gradient(45deg,#ece9df_0,#ece9df_3px,transparent_3px,transparent_8px)]' : ''}`}
                        >
                          {off && view !== 'month' && <span className="block text-[10px] uppercase tracking-wide text-ink-700">{off.category.replace('_', ' ').toLowerCase()}</span>}
                          {cell.map((x) => {
                            const conflict = conflictSet.has(`${p.id}:${x.assignmentId}`);
                            return (
                              <Link
                                key={x.assignmentId}
                                to={`/duties/${x.assignmentId}`}
                                title={`${x.referenceCode} · ${x.title} · ${new Date(x.plannedStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}–${new Date(x.plannedEnd).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}${conflict ? ' · CONFLICT' : ''}`}
                                className={`mb-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight text-white ${CATEGORY_STYLE[x.category].dot} ${conflict ? 'ring-2 ring-signal-bad ring-offset-1' : ''} ${x.status === 'DRAFT' ? 'opacity-60' : ''}`}
                              >
                                {view === 'month' ? (
                                  <span className="sr-only">{x.referenceCode}</span>
                                ) : (
                                  <span className="truncate">
                                    {new Date(x.plannedStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })} {tCode('category', x.category)}
                                  </span>
                                )}
                                <span aria-hidden className={view === 'month' ? 'block h-2 w-full' : 'hidden'} />
                              </Link>
                            );
                          })}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {r.data && r.data.conflicts.length > 0 && (
        <p className="mt-3 text-sm text-signal-bad" role="status">
          {r.data.conflicts.length} conflict{r.data.conflicts.length === 1 ? '' : 's'} in this period (overlapping duties or duty during recorded unavailability). Open the duty to
          reassign with a reason.
        </p>
      )}
    </>
  );
}
