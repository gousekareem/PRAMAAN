import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { DutyListItem, Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Pagination } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge } from '../components/ui/Badges';
import { CategoryBadge, ClassText, Disclaimer, DutyStatusBadge, Field, TimeRange, UnitSelect } from '../components/ops/Ops';
import { CATEGORY_SLUGS, t, tCode } from '../i18n';

const STATUSES = ['OPEN', 'DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'EXCEPTION_REPORTED', 'COMPLETED', 'CANCELLED'];

export function DutyAssignmentsPage() {
  const { slug } = useParams();
  const category = slug ? CATEGORY_SLUGS[slug] : undefined;
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [unitId, setUnitId] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useApi(
    () =>
      api<Page<DutyListItem>>(
        `/api/v1/duty-assignments${qs({
          page,
          pageSize: 20,
          category,
          status,
          unitId,
          q,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        })}`,
      ),
    [page, category, status, unitId, q, from, to],
  );
  useRefreshOnChange(list.reload);
  const title = category ? `${tCode('category', category)} duties` : t('duty.listTitle');
  return (
    <>
      <PageHeader
        title={title}
        subtitle={t('duty.listSubtitle')}
        actions={
          can('duty.create') ? (
            <Link className="btn-primary" to={`/duties/new${category ? `?category=${category}` : ''}`}>
              {t('duty.new')}
            </Link>
          ) : undefined
        }
      />
      <form
        className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-paper-200 bg-white p-3 md:grid-cols-5"
        onSubmit={(e) => e.preventDefault()}
        aria-label={t('common.filters')}
      >
        <Field label={t('duty.status')}>
          <select className="input w-full" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'OPEN' ? 'Open (not closed)' : tCode('status', s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('duty.unit')}>
          <UnitSelect value={unitId} onChange={(v) => { setUnitId(v); setPage(1); }} />
        </Field>
        <Field label={t('common.from')}>
          <input type="date" className="input w-full" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </Field>
        <Field label={t('common.to')}>
          <input type="date" className="input w-full" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </Field>
        <Field label={t('common.search')} className="col-span-2 md:col-span-1">
          <input type="search" className="input w-full" placeholder="Reference or title" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </Field>
      </form>
      <Disclaimer>{t('duty.attendanceDisclaimer')}</Disclaimer>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.items.length && <EmptyState title={t('duty.empty')} />}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('duty.reference')}</th>
                  <th scope="col">{t('duty.title')}</th>
                  <th scope="col">{t('duty.time')}</th>
                  <th scope="col">{t('duty.personnel')}</th>
                  <th scope="col">{t('duty.status')}</th>
                  <th scope="col">Check-ins</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">
                      <Link to={`/duties/${d.id}`} className="font-mono text-xs font-medium text-ink-800 underline-offset-2 hover:underline">
                        {d.referenceCode}
                      </Link>
                      <div className="mt-1">
                        <CategoryBadge category={d.category} restricted={d.isRestricted} />
                      </div>
                    </td>
                    <td>
                      <p className={d.detailsVisible ? '' : 'italic text-ink-700'}>{d.title}</p>
                      <p className="text-xs text-ink-700">
                        {d.unitName}
                        {d.trainRef ? ` · ${d.trainRef}` : ''}
                        {d.stationName && d.category === 'STATION_WATCH' ? ` · ${d.stationName}` : ''}
                      </p>
                      <DemoBadge show={d.isDemo} />
                    </td>
                    <td className="text-xs">
                      <TimeRange start={d.plannedStart} end={d.plannedEnd} />
                    </td>
                    <td className="text-xs">
                      {d.personnel.length ? (
                        <ul>
                          {d.personnel.map((p) => (
                            <li key={p.personnelId}>
                              {p.name}
                              {p.roleInDuty === 'LEAD' ? ' (lead)' : ''} · <span className="text-ink-700"><ClassText cls={p.personnelClass} /></span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-signal-warn">No one assigned</span>
                      )}
                    </td>
                    <td>
                      <DutyStatusBadge status={d.status} />
                      {d.openExceptions > 0 && (
                        <p className="mt-1 text-xs text-signal-warn">
                          {d.openExceptions} open exception{d.openExceptions === 1 ? '' : 's'}
                          {d.openConflicts ? ` (${d.openConflicts} conflict)` : ''}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs tabular-nums">
                      {d.checkinsAcknowledged} ack · {d.checkinsMissed} missed
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
