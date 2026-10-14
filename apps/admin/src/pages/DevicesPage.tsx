import { useState } from 'react';
import { api, ApiError, qs } from '../services/api';
import type { Page } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog, HashText, PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { DemoBadge, StatusBadge } from '../components/ui/Badges';

interface DeviceRow {
  id: string;
  officerName: string;
  label: string;
  platform: string;
  status: string;
  keyFingerprint: string;
  keyHardwareBacked: boolean | null;
  appVersion: string | null;
  isDemo: boolean;
  registeredAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  lastSyncAt: string | null;
  lastSequence: number | null;
  lastEventHash: string | null;
}

export function DevicesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<{ d: DeviceRow; action: 'approve' | 'revoke' } | null>(
    null,
  );
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useApi(
    () => api<Page<DeviceRow>>(`/api/v1/devices${qs({ page, status })}`),
    [page, status],
  );
  async function confirm(note: string) {
    if (!pending) return;
    try {
      await api(`/api/v1/devices/${pending.d.id}/${pending.action}`, {
        method: 'POST',
        body: JSON.stringify(pending.action === 'revoke' ? { reason: note } : {}),
      });
      setNotice({
        ok: true,
        text: `Device ${pending.action === 'approve' ? 'approved' : 'revoked'} (audited).`,
      });
      void list.reload();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError ? e.message : 'Action failed' });
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <PageHeader
        title="Registered devices"
        subtitle="Each device holds its own signing key; the server stores only the public key. Approval and revocation are administrator-only actions."
      />
      <label className="mb-3 block max-w-xs text-sm">
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
          <option>PENDING</option>
          <option>ACTIVE</option>
          <option>REVOKED</option>
        </select>
      </label>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`mb-3 text-sm ${notice.ok ? 'text-signal-ok' : 'text-signal-bad'}`}
        >
          {notice.text}
        </p>
      )}
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 && <EmptyState title="No devices" />}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Officer</th>
                <th>Status</th>
                <th>Key fingerprint</th>
                <th>Last sync / head</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.label} <DemoBadge show={d.isDemo} />
                    <div className="text-xs text-ink-700">
                      {d.platform}
                      {d.keyHardwareBacked ? ' · hardware-backed' : ''} · {d.appVersion ?? '—'}
                    </div>
                  </td>
                  <td>{d.officerName}</td>
                  <td>
                    <StatusBadge value={d.status} />
                    {d.revocationReason && (
                      <div className="text-xs text-ink-700">{d.revocationReason}</div>
                    )}
                  </td>
                  <td>
                    <HashText value={d.keyFingerprint} short />
                  </td>
                  <td>
                    {formatTime(d.lastSyncAt)}
                    <div className="text-xs">
                      seq {d.lastSequence ?? '—'} <HashText value={d.lastEventHash} short />
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="space-x-2 whitespace-nowrap">
                      {d.status === 'PENDING' && (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => setPending({ d, action: 'approve' })}
                        >
                          Approve
                        </button>
                      )}
                      {d.status !== 'REVOKED' && (
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => setPending({ d, action: 'revoke' })}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  )}
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
      <ConfirmDialog
        open={!!pending}
        title={pending?.action === 'approve' ? 'Approve device' : 'Revoke device'}
        body={
          pending?.action === 'approve'
            ? 'Events signed by this device key will be accepted after approval. Verify the key fingerprint with the officer first.'
            : 'Revocation stops all synchronisation from this device and ends its sessions. Already accepted events are preserved.'
        }
        confirmLabel={pending?.action === 'approve' ? 'Approve' : 'Revoke'}
        requireNote={pending?.action === 'revoke'}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />
    </>
  );
}
