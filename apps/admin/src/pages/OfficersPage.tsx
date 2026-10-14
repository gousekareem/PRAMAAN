import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge } from '../components/ui/Badges';

interface OfficerRow {
  id: string;
  employeeRef: string;
  displayName: string;
  rank: string;
  station: string;
  isActive: boolean;
  isDemo: boolean;
  lastSyncAt: string | null;
  openFlags: number;
  activeDutyId: string | null;
}

export function OfficersPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi(
    () => api<Page<OfficerRow>>(`/api/v1/officers${qs({ page, q })}`),
    [page, q],
  );
  return (
    <>
      <PageHeader
        title="Officers"
        subtitle="Pseudonymous references only. Last synchronisation is server receipt time."
      />
      <label className="mb-3 block max-w-xs text-sm">
        Search
        <input
          className="input mt-1 w-full"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          placeholder="Name or reference"
        />
      </label>
      {loading && !data && <LoadingState />}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 && <EmptyState title="No officers match" />}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Reference</th>
                <th>Rank</th>
                <th>Duty</th>
                <th>Last sync (server)</th>
                <th>Open flags</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      to={`/officers/${o.id}`}
                    >
                      {o.displayName}
                    </Link>{' '}
                    <DemoBadge show={o.isDemo} />
                  </td>
                  <td className="font-mono text-xs">{o.employeeRef}</td>
                  <td>{o.rank.replace('_', ' ')}</td>
                  <td>
                    {o.activeDutyId ? (
                      <Badge tone="ok">On duty</Badge>
                    ) : (
                      <Badge tone="muted">No active duty</Badge>
                    )}
                  </td>
                  <td>{formatTime(o.lastSyncAt)}</td>
                  <td>{o.openFlags ? <Badge tone="warn">{o.openFlags}</Badge> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          onPage={setPage}
        />
      )}
    </>
  );
}
