import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../services/api';
import type { EvidenceListItem, Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useRefreshOnChange } from '../hooks/useRefreshOnChange';
import { HashText, PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge } from '../components/ui/Badges';
import { CategoryBadge } from '../components/ops/Ops';
import { tCode } from '../i18n';
import type { DutyCategory } from '../services/types';

/**
 * Evidence states as seen by the server. "Pending on device" cannot be observed here; the
 * duty app shows it until the event synchronises.
 */
export function EvidenceStateBadge({ status, attempts }: { status: string; attempts?: number }) {
  if (status === 'VERIFIED') return <Badge tone="ok">Verified (hash matches)</Badge>;
  if (status === 'QUARANTINED') return <Badge tone="bad">Failed integrity check</Badge>;
  if (status === 'AWAITING_UPLOAD' && (attempts ?? 0) >= 5)
    return <Badge tone="bad" title="Upload attempts exhausted">Incomplete (upload limit reached)</Badge>;
  if (status === 'AWAITING_UPLOAD') return <Badge tone="warn">Synchronised · image pending</Badge>;
  return <Badge tone="muted">{status}</Badge>;
}

export function EvidencePage() {
  const [page, setPage] = useState(1);
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [category, setCategory] = useState('');
  const [hash, setHash] = useState('');
  const validHash = /^[0-9a-f]{4,64}$/.test(hash) ? hash : '';
  const { data, error, loading, reload } = useApi(
    () =>
      api<Page<EvidenceListItem & { assignment: { id: string; referenceCode: string; category: DutyCategory } | null; uploadAttempts?: number }>>(
        `/api/v1/evidence${qs({ page, status, hash: validHash, category })}`,
      ),
    [page, status, validHash, category],
  );
  useRefreshOnChange(reload);
  return (
    <>
      <PageHeader
        title="Evidence verification"
        subtitle="Server-verified status reflects a SHA-256 comparison of received bytes with the signed declaration. Integrity is not proof that the scene was genuine or that anyone was physically present. Evidence of restricted duties is visible only to authorised users."
      />
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label>
          Status
          <select
            className="input mt-1 block"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">All</option>
            <option value="VERIFIED">Verified</option>
            <option value="AWAITING_UPLOAD">Awaiting upload</option>
            <option value="QUARANTINED">Failed (quarantined)</option>
          </select>
        </label>
        <label>
          Duty category
          <select
            className="input mt-1 block"
            value={category}
            onChange={(e) => {
              setPage(1);
              setCategory(e.target.value);
            }}
          >
            <option value="">All</option>
            {(['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'] as const).map((c) => (
              <option key={c} value={c}>
                {tCode('category', c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          SHA-256 prefix
          <input
            className="input mt-1 block w-64 font-mono"
            value={hash}
            onChange={(e) => {
              setPage(1);
              setHash(e.target.value.trim().toLowerCase());
            }}
            placeholder="e.g. 3fa9c0"
            aria-invalid={!!hash && !validHash}
          />
        </label>
      </div>
      {loading && !data && <LoadingState />}
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 && <EmptyState title="No evidence matches the filters" />}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Evidence</th>
                <th>Personnel / duty</th>
                <th>Captured (device clock)</th>
                <th>Received (server)</th>
                <th>Status</th>
                <th>Image SHA-256</th>
                <th>Screen risk*</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.evidenceId}>
                  <td>
                    <Link to={`/evidence/${e.evidenceId}`} className="font-mono text-xs underline">
                      {e.evidenceId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    {e.officerName} <DemoBadge show={e.isDemo} />
                    {e.assignment && (
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                        <Link to={`/duties/${e.assignment.id}`} className="font-mono underline">
                          {e.assignment.referenceCode}
                        </Link>
                        <CategoryBadge category={e.assignment.category} />
                      </p>
                    )}
                  </td>
                  <td>{formatTime(e.capturedAtDevice)}</td>
                  <td>{formatTime(e.serverReceivedAt)}</td>
                  <td>
                    <EvidenceStateBadge status={e.status} attempts={e.uploadAttempts} />
                  </td>
                  <td>
                    <HashText value={e.imageSha256} short />
                  </td>
                  <td>
                    {e.screenRiskScore === null ? (
                      '—'
                    ) : (
                      <Badge tone={e.screenRiskScore >= 0.8 ? 'warn' : 'muted'}>
                        {e.screenRiskScore.toFixed(2)}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-700">
        * Experimental screen re-capture estimate. Periodic textures (tiles, grilles, fabric)
        produce false positives.
      </p>
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
