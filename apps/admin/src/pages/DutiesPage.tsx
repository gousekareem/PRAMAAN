import { useState, type FormEvent } from 'react';
import type { FeatureCollection } from 'geojson';
import { api, ApiError, qs } from '../services/api';
import type { Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';

interface Duty {
  id: string;
  officerId: string;
  officerName: string;
  plannedStart: string;
  plannedEnd: string;
  status: string;
  deviceStartedAt: string | null;
  notes: string | null;
  isDemo: boolean;
  zones: { id: string; code: string; name: string }[];
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DutiesPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const list = useApi(
    () => api<Page<Duty>>(`/api/v1/duties${qs({ page, status })}`),
    [page, status],
  );
  const canCreate = can('duty.create');
  return (
    <>
      <PageHeader
        title="Individual duty sessions"
        subtitle="Per-person device sessions (PRAMAAN 1.0). Sessions created through duty assignments appear here as well. Planned windows are authorised on the server; device-reported start times are shown separately and are not trusted."
      />
      {canCreate && <CreateDuty onCreated={list.reload} />}
      <label className="mb-3 mt-4 block max-w-xs text-sm">
        Status
        <select
          className="input mt-1 w-full"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All</option>
          <option>PLANNED</option>
          <option>ACTIVE</option>
          <option>COMPLETED</option>
          <option>CANCELLED</option>
        </select>
      </label>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 && <EmptyState title="No duty sessions" />}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Planned window</th>
                <th>Zones</th>
                <th>Status</th>
                <th>Device-reported start</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.officerName} <DemoBadge show={d.isDemo} />
                  </td>
                  <td>
                    {formatTime(d.plannedStart)} – {formatTime(d.plannedEnd)}
                  </td>
                  <td>{d.zones.map((z) => z.code).join(', ')}</td>
                  <td>
                    <StatusBadge value={d.status} />
                  </td>
                  <td>{formatTime(d.deviceStartedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && (
        <Pagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          onPage={setPage}
        />
      )}
    </>
  );
}

function CreateDuty({ onCreated }: { onCreated: () => void }) {
  const officers = useApi(
    () =>
      api<Page<{ id: string; displayName: string; isActive: boolean }>>(
        '/api/v1/officers?pageSize=100&active=true',
      ),
    [],
  );
  const zones = useApi(() => api<FeatureCollection>('/api/v1/zones'), []);
  const now = new Date();
  const [officerId, setOfficerId] = useState('');
  const [start, setStart] = useState(toLocalInput(now));
  const [end, setEnd] = useState(toLocalInput(new Date(now.getTime() + 8 * 3600_000)));
  const [zoneIds, setZoneIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/api/v1/duties', {
        method: 'POST',
        body: JSON.stringify({
          officerId,
          plannedStart: new Date(start).toISOString(),
          plannedEnd: new Date(end).toISOString(),
          zoneIds,
          ...(notes ? { notes } : {}),
        }),
      });
      setMsg({ ok: true, text: 'Duty session created and audited.' });
      onCreated();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not create duty.' });
    }
  }
  return (
    <Card title="Authorise a duty session">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          Officer
          <select
            required
            className="input mt-1 w-full"
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
          >
            <option value="">Select…</option>
            {officers.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Planned start
          <input
            required
            type="datetime-local"
            className="input mt-1 w-full"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Planned end
          <input
            required
            type="datetime-local"
            className="input mt-1 w-full"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Notes
          <input
            maxLength={500}
            className="input mt-1 w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <fieldset className="text-sm md:col-span-2 lg:col-span-4">
          <legend>Assigned zones</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {(zones.data?.features ?? []).map((f) => {
              const p = f.properties as { id: string; name: string };
              return (
                <label key={p.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={zoneIds.includes(p.id)}
                    onChange={(e) =>
                      setZoneIds((z) =>
                        e.target.checked ? [...z, p.id] : z.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-3 md:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="btn-primary"
            disabled={!officerId || zoneIds.length === 0}
          >
            Create duty session
          </button>
          {msg && (
            <p
              role={msg.ok ? 'status' : 'alert'}
              className={`text-sm ${msg.ok ? 'text-signal-ok' : 'text-signal-bad'}`}
            >
              {msg.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
