import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { api, download, ApiError } from '../services/api';
import type { EvidenceDetail } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, HashText, KV, PageHeader, TimeText, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge, StatusBadge } from '../components/ui/Badges';
import { EvidenceImage } from '../evidence/EvidenceImage';

export function VerificationSummary({ d }: { d: EvidenceDetail }) {
  const match = d.status === 'VERIFIED' && d.computedImageSha256 === d.imageSha256;
  return (
    <div
      role="status"
      className={`rounded-lg border p-4 ${match ? 'border-signal-ok/30 bg-emerald-50' : d.status === 'QUARANTINED' ? 'border-signal-bad/30 bg-red-50' : 'border-signal-warn/30 bg-amber-50'}`}
    >
      <p
        className={`font-semibold ${match ? 'text-signal-ok' : d.status === 'QUARANTINED' ? 'text-signal-bad' : 'text-signal-warn'}`}
      >
        {match
          ? 'Integrity verified: server-computed SHA-256 matches the signed declaration'
          : d.status === 'QUARANTINED'
            ? 'Evidence rejected: received bytes did not match the signed declaration'
            : 'Awaiting evidence upload from the device'}
      </p>
      <p className="mt-1 text-xs text-ink-800">
        Integrity ≠ authenticity. A match shows the bytes are unchanged since the device hashed
        them; it does not prove the scene, time, place or person.
      </p>
    </div>
  );
}

export function EvidenceDetailPage() {
  const { id = '' } = useParams();
  const { hasRole } = useAuth();
  const {
    data: d,
    error,
    loading,
    reload,
  } = useApi(() => api<EvidenceDetail>(`/api/v1/evidence/${id}`), [id]);
  const [exportError, setExportError] = useState<string | null>(null);
  if (loading && !d) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return null;
  const m = d.manifest;
  const doExport = (path: string, name: string) =>
    download(path, name).catch((e) =>
      setExportError(e instanceof ApiError ? e.message : 'Export failed'),
    );
  return (
    <>
      <PageHeader
        title={`Evidence ${d.evidenceId.slice(0, 8)}`}
        subtitle={`${d.officer.displayName} (${d.officer.employeeRef})`}
        actions={
          <>
            <DemoBadge show={d.officer.isDemo} />
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                doExport(`/api/v1/evidence/${d.evidenceId}/manifest.json`, 'manifest.json')
              }
            >
              Manifest JSON
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => doExport(`/api/v1/evidence/${d.evidenceId}/report.pdf`, 'report.pdf')}
            >
              Report PDF
            </button>
            {hasRole('ADMIN', 'SUPERVISOR') && d.status === 'VERIFIED' && (
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  doExport(`/api/v1/evidence/${d.evidenceId}/package`, 'evidence-package.zip')
                }
              >
                Export verification package
              </button>
            )}
          </>
        }
      />
      {exportError && (
        <p role="alert" className="mb-3 text-sm text-signal-bad">
          {exportError}
        </p>
      )}
      <VerificationSummary d={d} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Integrity">
          <dl>
            <KV k="Server status">
              <StatusBadge value={d.status} />
            </KV>
            <KV k="Declared image SHA-256">
              <HashText value={d.imageSha256} />
            </KV>
            <KV k="Server-computed SHA-256">
              <HashText value={d.computedImageSha256} />
            </KV>
            <KV k="Manifest SHA-256">
              <HashText value={d.manifestSha256} />
            </KV>
            <KV k="Bytes">
              {m.image.byteLength.toLocaleString()} · {m.image.width}×{m.image.height} ·{' '}
              {m.image.mimeType}
            </KV>
            <KV k="Upload attempts">{d.uploadAttempts}</KV>
            <KV k="Screen re-capture risk">
              {d.screenRecaptureRisk?.score !== undefined ? (
                <>
                  <Badge tone={d.screenRecaptureRisk.score >= 0.8 ? 'warn' : 'muted'}>
                    {d.screenRecaptureRisk.score.toFixed(2)}
                  </Badge>{' '}
                  <span className="text-xs text-ink-700">experimental, probabilistic</span>
                </>
              ) : (
                'Not available'
              )}
            </KV>
          </dl>
        </Card>
        <Card title="Evidence preview">
          {d.canViewImage ? (
            d.status === 'VERIFIED' ? (
              <EvidenceImage evidenceId={d.evidenceId} />
            ) : (
              <p className="text-sm text-ink-700">No verified image bytes available.</p>
            )
          ) : (
            <p className="text-sm text-ink-700">
              Image content is restricted to supervisors and administrators. Metadata remains
              available for review.
            </p>
          )}
        </Card>
        <Card title="Time (kept separate — device clocks are not trusted)">
          <dl>
            <KV k="Capture (device clock)">
              <TimeText iso={d.times.deviceWallTime} source="device" />
            </KV>
            <KV k="Trusted-time estimate">
              <TimeText iso={d.times.trustedTimeEstimate} source="trusted-estimate" />
              {m.capture.trustedTimeUncertaintyMs !== null && (
                <span className="text-xs"> ± {m.capture.trustedTimeUncertaintyMs} ms</span>
              )}
            </KV>
            <KV k="Server receipt">
              <TimeText iso={d.times.serverReceivedAt} source="server" />
            </KV>
            <KV k="Server processed">
              <TimeText iso={d.times.serverProcessedAt} source="server" />
            </KV>
            <KV k="Bytes uploaded">
              <TimeText iso={d.times.uploadReceivedAt} source="server" />
            </KV>
            <KV k="Verified">
              <TimeText iso={d.times.verifiedAt} source="server" />
            </KV>
          </dl>
        </Card>
        <Card title="Location and device observations">
          <dl>
            <KV k="Location">
              {m.location.availability === 'AVAILABLE' ? (
                <span className="font-mono text-xs">
                  {m.location.latitude?.toFixed(6)}, {m.location.longitude?.toFixed(6)}
                </span>
              ) : (
                m.location.availability
              )}
            </KV>
            <KV k="Accuracy">
              {m.location.horizontalAccuracyM === null
                ? 'Location accuracy unavailable'
                : `±${m.location.horizontalAccuracyM} m`}{' '}
              ({m.location.provider ?? 'unknown provider'})
            </KV>
            <KV k="Mock indicator">
              {m.location.mockIndicator === null
                ? 'Not reported'
                : String(m.location.mockIndicator)}{' '}
              <span className="text-xs text-ink-700">(client-reported)</span>
            </KV>
            <KV k="Cellular">{m.cellular.availability}</KV>
            <KV k="Steps since boot">{m.motion.stepsSinceBoot ?? 'Unavailable'}</KV>
            <KV k="Root indicators">
              {m.devicePosture.rootIndicators.length
                ? m.devicePosture.rootIndicators.join(', ')
                : 'None reported (heuristic)'}
            </KV>
            <KV k="Emulator indicators">
              {m.devicePosture.emulatorIndicators.length
                ? m.devicePosture.emulatorIndicators.join(', ')
                : 'None reported'}
            </KV>
            <KV k="Hardware-backed key">
              {m.devicePosture.keyHardwareBacked === null
                ? 'Unknown'
                : String(m.devicePosture.keyHardwareBacked)}
            </KV>
            <KV k="Camera API">{m.capture.captureApi}</KV>
          </dl>
        </Card>
        <Card title="Ledger hash relationships" className="lg:col-span-2">
          <ol className="space-y-2 text-sm">
            {d.ledger.neighbours.map((n) => (
              <li
                key={n.eventId}
                className={`rounded border p-2 ${n.sequence === d.ledger.sequence ? 'border-ink-600 bg-paper-50' : 'border-paper-200'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="muted">#{n.sequence}</Badge>
                  <span className="font-medium">{n.eventType}</span>
                  <span className="text-xs text-ink-700">
                    {formatTime(n.deviceWallTime)} (device)
                  </span>
                </div>
                <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
                  <span>
                    previous: <HashText value={n.previousEventHash} short />
                  </span>
                  <span>
                    hash: <HashText value={n.eventHash} short />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Chain of custody (audit)" className="lg:col-span-2">
          <ol className="divide-y divide-paper-100 text-sm">
            {d.custody.map((c) => (
              <li key={c.auditId} className="flex flex-wrap items-center gap-2 py-1.5">
                <Badge tone="muted">#{c.sequence}</Badge>
                <span className="font-medium">{c.action}</span>
                <span className="text-ink-700">{c.actorRole ?? 'system'}</span>
                <span className="text-xs">{formatTime(c.occurredAt)}</span>
                <span className="ml-auto">
                  <HashText value={c.recordHash} short />
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
