import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Card, KV, PageHeader, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Badge } from '../components/ui/Badges';
import { t } from '../i18n';

interface Status {
  generatedAt: string;
  api: { status: string; uptimeSeconds: number; node: string; environment: string };
  database: { status: string; latencyMs?: number; pg?: string; postgis?: string; migrations?: number; latest?: string; error?: string; pool?: { total: number; idle: number; waiting: number } };
  evidenceStorage: { status: string; writable: boolean; freeBytes?: number; totalBytes?: number; error?: string };
  synchronisation: {
    lastBatchReceivedAt: string | null;
    batches24h: number;
    rejections24h: number;
    evidenceAwaitingUpload: number;
    evidenceQuarantined: number;
    activeDevices: number;
    openSyncFailures: number;
  };
  auditChain: { ok: boolean; checked?: number; issues?: number; error?: string };
  backup: { status: 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE'; detail?: string; checkedAt?: string; [k: string]: unknown };
  demoLoginAllowed: boolean;
}

const gb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 ** 3).toFixed(1)} GB`);
const tone = (ok: boolean) => (ok ? 'ok' : 'bad') as 'ok' | 'bad';

/** Protected status page. Every value is measured when the page loads; nothing is assumed. */
export function SystemStatusPage() {
  const s = useApi(() => api<Status>('/api/v1/system/status'), []);
  if (s.loading && !s.data) return <LoadingState label="Measuring…" />;
  if (s.error) return <ErrorState error={s.error} onRetry={s.reload} />;
  const x = s.data!;
  return (
    <>
      <PageHeader
        title={t('system.title')}
        subtitle={`Measured at ${formatTime(x.generatedAt)}. Backup status is shown only when a verification result file exists.`}
        actions={
          <button type="button" className="btn-secondary" onClick={() => void s.reload()}>
            Re-check
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Backend API">
          <dl>
            <KV k="Status" stacked><Badge tone="ok">{x.api.status}</Badge></KV>
            <KV k="Uptime" stacked>{Math.round(x.api.uptimeSeconds / 60)} min</KV>
            <KV k="Runtime / environment" stacked>{x.api.node} · {x.api.environment}</KV>
            <KV k="Demo accounts can sign in" stacked>{x.demoLoginAllowed ? <Badge tone="warn">yes</Badge> : <Badge tone="ok">no</Badge>}</KV>
          </dl>
        </Card>
        <Card title="Database">
          <dl>
            <KV k="Status" stacked><Badge tone={tone(x.database.status === 'ok')}>{x.database.status}</Badge></KV>
            {x.database.error && <KV k="Error" stacked>{x.database.error}</KV>}
            <KV k="Latency" stacked>{x.database.latencyMs ?? '—'} ms</KV>
            <KV k="PostgreSQL / PostGIS" stacked>{x.database.pg ?? '—'} / {x.database.postgis ?? '—'}</KV>
            <KV k="Migrations" stacked>{x.database.migrations ?? '—'} applied (latest {x.database.latest ?? '—'})</KV>
            {x.database.pool && <KV k="Pool" stacked>{x.database.pool.total} total · {x.database.pool.idle} idle · {x.database.pool.waiting} waiting</KV>}
          </dl>
        </Card>
        <Card title="Evidence storage">
          <dl>
            <KV k="Write/read probe" stacked><Badge tone={tone(x.evidenceStorage.status === 'ok')}>{x.evidenceStorage.status}</Badge></KV>
            {x.evidenceStorage.error && <KV k="Error" stacked>{x.evidenceStorage.error}</KV>}
            <KV k="Free / total" stacked>{gb(x.evidenceStorage.freeBytes)} / {gb(x.evidenceStorage.totalBytes)}</KV>
          </dl>
        </Card>
        <Card title="Synchronisation">
          <dl>
            <KV k="Last batch received" stacked>{formatTime(x.synchronisation.lastBatchReceivedAt)}</KV>
            <KV k="Batches (24 h)" stacked>{x.synchronisation.batches24h}</KV>
            <KV k="Rejected events (24 h)" stacked>{x.synchronisation.rejections24h}</KV>
            <KV k="Evidence awaiting upload / quarantined" stacked>
              {x.synchronisation.evidenceAwaitingUpload} / {x.synchronisation.evidenceQuarantined}
            </KV>
            <KV k="Open sync-failure exceptions" stacked>{x.synchronisation.openSyncFailures}</KV>
            <KV k="Active devices" stacked>{x.synchronisation.activeDevices}</KV>
          </dl>
        </Card>
        <Card title="Audit chain">
          <dl>
            <KV k="Verification" stacked><Badge tone={tone(x.auditChain.ok)}>{x.auditChain.ok ? 'intact' : 'problem detected'}</Badge></KV>
            <KV k="Records checked" stacked>{x.auditChain.checked ?? '—'}</KV>
            {x.auditChain.error && <KV k="Error" stacked>{x.auditChain.error}</KV>}
          </dl>
        </Card>
        <Card title="Backup verification">
          <dl>
            <KV k="Status" stacked>
              <Badge tone={x.backup.status === 'VERIFIED' ? 'ok' : x.backup.status === 'FAILED' ? 'bad' : 'muted'}>{x.backup.status.replace('_', ' ').toLowerCase()}</Badge>
            </KV>
            {x.backup.detail && <KV k="Detail" stacked>{x.backup.detail}</KV>}
            {typeof x.backup.checkedAt === 'string' && <KV k="Checked at" stacked>{formatTime(x.backup.checkedAt)}</KV>}
          </dl>
        </Card>
      </div>
    </>
  );
}
