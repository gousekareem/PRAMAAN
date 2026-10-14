import type { FreshnessLabel } from '../../services/types';

const tones = {
  ok: 'bg-emerald-50 text-signal-ok ring-signal-ok/30',
  warn: 'bg-amber-50 text-signal-warn ring-signal-warn/30',
  bad: 'bg-red-50 text-signal-bad ring-signal-bad/30',
  info: 'bg-blue-50 text-signal-info ring-signal-info/30',
  muted: 'bg-gray-100 text-signal-stale ring-gray-300',
} as const;
export type Tone = keyof typeof tones;

export function Badge({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const statusTone: Record<string, Tone> = {
  VERIFIED: 'ok',
  EVIDENCE_VERIFIED: 'ok',
  ACTIVE: 'ok',
  INSIDE_ASSIGNED_ZONE: 'ok',
  ACKNOWLEDGED: 'info',
  RESOLVED: 'ok',
  COMPLETED: 'muted',
  QUARANTINED: 'bad',
  EVIDENCE_QUARANTINED: 'bad',
  REVOKED: 'bad',
  OUTSIDE_ASSIGNED_ZONE: 'warn',
  MISSED: 'warn',
  AWAITING_UPLOAD: 'warn',
  EVIDENCE_PENDING: 'warn',
  PENDING: 'warn',
  OPEN: 'warn',
  ASSIGNED: 'info',
  ACKNOWLEDGED_LATE: 'warn',
  OUTSIDE_WITHIN_ACCURACY: 'info',
  NO_LOCATION: 'muted',
  NO_ASSIGNED_ZONE: 'muted',
  DISMISSED: 'muted',
  PLANNED: 'info',
  CANCELLED: 'muted',
  HIGH: 'bad',
  MEDIUM: 'warn',
  LOW: 'info',
  INFO: 'muted',
};

const statusText: Record<string, string> = {
  VERIFIED: 'Evidence verified',
  QUARANTINED: 'Evidence rejected (quarantined)',
  AWAITING_UPLOAD: 'Awaiting upload',
  EVIDENCE_VERIFIED: 'Evidence verified',
  EVIDENCE_QUARANTINED: 'Evidence rejected',
  EVIDENCE_PENDING: 'Evidence pending',
  INSIDE_ASSIGNED_ZONE: 'Inside assigned zone',
  OUTSIDE_WITHIN_ACCURACY: 'Boundary (within GPS accuracy)',
  OUTSIDE_ASSIGNED_ZONE: 'Outside assigned zone',
  NO_LOCATION: 'No location',
  NO_ASSIGNED_ZONE: 'No assigned zone',
  ACKNOWLEDGED_LATE: 'Acknowledged late',
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <Badge tone="muted">—</Badge>;
  return (
    <Badge tone={statusTone[value] ?? 'muted'}>
      {statusText[value] ??
        value
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/^./, (c) => c.toUpperCase())}
    </Badge>
  );
}

export const freshnessText: Record<FreshnessLabel, string> = {
  RECENTLY_RECEIVED: 'Recently received',
  DELAYED_SYNC: 'Delayed synchronization',
  OFFLINE_LAST_KNOWN: 'Offline; last observation known',
  STALE: 'Stale observation',
};

export const freshnessColor: Record<FreshnessLabel, string> = {
  RECENTLY_RECEIVED: '#1f7a4d',
  DELAYED_SYNC: '#a86100',
  OFFLINE_LAST_KNOWN: '#285e9e',
  STALE: '#6b7280',
};

/** Freshness is always shown explicitly — PRAMAAN never labels an observation as "live". */
export function FreshnessBadge({ label }: { label: FreshnessLabel }) {
  const tone: Tone =
    label === 'RECENTLY_RECEIVED'
      ? 'ok'
      : label === 'DELAYED_SYNC'
        ? 'warn'
        : label === 'OFFLINE_LAST_KNOWN'
          ? 'info'
          : 'muted';
  return <Badge tone={tone}>{freshnessText[label]}</Badge>;
}

export function DemoBadge({ show }: { show: boolean | null | undefined }) {
  if (!show) return null;
  return (
    <Badge tone="warn" title="Synthetic demonstration record">
      DEMO
    </Badge>
  );
}
