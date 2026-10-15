import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText, qs, send } from '../services/api';
import type { Page, PersonnelItem } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge } from '../components/ui/Badges';
import { ClassText, Field, Notice, UnitSelect } from '../components/ops/Ops';
import { t, tCode } from '../i18n';

const CLASSES = ['HG', 'PC_AR', 'PC_GENERAL', 'PC', 'HC', 'ASI', 'SI', 'CI', 'DSP'];

export function PersonnelPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [unitId, setUnitId] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useApi(
    () =>
      api<Page<PersonnelItem>>(`/api/v1/personnel${qs({ page, pageSize: 25, q, personnelClass: cls, status, unitId })}`),
    [page, q, cls, status, unitId],
  );
  const stats = useApi(
    () => api<{ totalActive: number; totalInactive: number; byClass: Record<string, { active: number; inactive: number }> }>('/api/v1/personnel/stats'),
    [],
  );
  return (
    <>
      <PageHeader
        title={t('personnel.title')}
        subtitle={t('personnel.subtitle')}
        actions={
          can('personnel.manage') ? (
            <button type="button" className="btn-primary" onClick={() => setCreating((c) => !c)}>
              {creating ? t('common.cancel') : 'Add personnel'}
            </button>
          ) : undefined
        }
      />
      {creating && <CreatePersonnel onDone={() => { setCreating(false); void list.reload(); void stats.reload(); }} />}
      {stats.data && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Personnel counts by class">
          <Badge tone="info">{stats.data.totalActive} active</Badge>
          {stats.data.totalInactive > 0 && <Badge tone="muted">{stats.data.totalInactive} inactive</Badge>}
          {CLASSES.filter((c) => stats.data!.byClass[c]).map((c) => (
            <Badge key={c} tone="muted">
              {tCode('class', c)}: {stats.data!.byClass[c]!.active}
            </Badge>
          ))}
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-paper-200 bg-white p-3 md:grid-cols-4">
        <Field label={t('common.search')}>
          <input type="search" className="input w-full" placeholder="Name or personnel ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </Field>
        <Field label="Rank / category / subtype">
          <select className="input w-full" value={cls} onChange={(e) => { setCls(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {tCode('class', c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="input w-full" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
        <Field label={t('duty.unit')}>
          <UnitSelect value={unitId} onChange={(v) => { setUnitId(v); setPage(1); }} />
        </Field>
      </div>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.items.length && <EmptyState title="No personnel match these filters." />}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Personnel ID</th>
                  <th scope="col">Rank / classification</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Open duties</th>
                  <th scope="col">Last device sync</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/personnel/${p.id}`} className="font-medium hover:underline">
                        {p.displayName}
                      </Link>{' '}
                      <DemoBadge show={p.isDemo} />
                    </td>
                    <td className="font-mono text-xs">{p.personnelRef}</td>
                    <td className="text-xs">
                      <ClassText cls={p.personnelClass} />
                    </td>
                    <td className="text-xs">{p.unitName ?? '—'}</td>
                    <td className="tabular-nums">{p.openDuties ?? 0}</td>
                    <td className="text-xs">{p.lastSyncAt ? formatTime(p.lastSyncAt) : '—'}</td>
                    <td>{p.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
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

function CreatePersonnel({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ personnelRef: '', displayName: '', personnelCategory: 'POLICE', rank: 'PC', constableCategory: '', gender: 'NOT_RECORDED', unitId: '' });
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await send('/api/v1/personnel', 'POST', {
        personnelRef: f.personnelRef.toUpperCase(),
        displayName: f.displayName,
        personnelCategory: f.personnelCategory,
        rank: f.personnelCategory === 'HOME_GUARD' ? null : f.rank,
        constableCategory: f.rank === 'PC' && f.personnelCategory === 'POLICE' && f.constableCategory ? f.constableCategory : null,
        gender: f.gender,
        unitId: f.unitId,
      });
      onDone();
    } catch (x) {
      setErr(errorText(x));
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mb-4 grid gap-3 rounded-lg border border-ink-600/30 bg-white p-4 md:grid-cols-4">
      {err && <div className="md:col-span-4"><Notice tone="bad">{err}</Notice></div>}
      <Field label="Personnel ID" hint="Unique; letters, digits and hyphens.">
        <input className="input w-full" required pattern="[A-Za-z0-9-]{3,32}" value={f.personnelRef} onChange={(e) => setF({ ...f, personnelRef: e.target.value })} />
      </Field>
      <Field label="Display name">
        <input className="input w-full" required minLength={2} maxLength={80} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </Field>
      <Field label="Personnel category">
        <select className="input w-full" value={f.personnelCategory} onChange={(e) => setF({ ...f, personnelCategory: e.target.value })}>
          <option value="POLICE">Police (rank hierarchy)</option>
          <option value="HOME_GUARD">Home Guard (separate category)</option>
        </select>
      </Field>
      {f.personnelCategory === 'POLICE' && (
        <Field label="Rank">
          <select className="input w-full" value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value })}>
            {['PC', 'HC', 'ASI', 'SI', 'CI', 'DSP'].map((r) => (
              <option key={r} value={r}>
                {tCode('class', r)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {f.personnelCategory === 'POLICE' && f.rank === 'PC' && (
        <Field label="Constable subtype" hint="Confirm local designation with the department.">
          <select className="input w-full" value={f.constableCategory} onChange={(e) => setF({ ...f, constableCategory: e.target.value })}>
            <option value="">Not recorded</option>
            <option value="AR">AR (Armed Reserve)</option>
            <option value="GENERAL">General</option>
          </select>
        </Field>
      )}
      <Field label="Gender (only if explicitly supplied)">
        <select className="input w-full" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
          <option value="NOT_RECORDED">Not recorded</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </Field>
      <Field label={t('duty.unit')}>
        <UnitSelect value={f.unitId} onChange={(v) => setF({ ...f, unitId: v })} allowAll={false} />
      </Field>
      <div className="flex items-end">
        <button type="submit" className="btn-primary" disabled={!f.unitId}>
          Create record
        </button>
      </div>
    </form>
  );
}
