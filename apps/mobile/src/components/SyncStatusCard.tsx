import { Text } from 'react-native';
import type { SyncSnapshot, SyncStatus } from '../sync/syncEngine';
import { Card, Row, colors } from './ui';

const LABEL: Record<SyncStatus, { text: string; color: string }> = {
  OFFLINE: { text: 'Offline — recording locally', color: colors.muted },
  PENDING: { text: 'Pending sync', color: colors.warn },
  SYNCING: { text: 'Syncing…', color: colors.inkSoft },
  SYNCED: { text: 'Synced', color: colors.ok },
  FAILED: { text: 'Sync failed — will retry', color: colors.bad },
  AUTH_REQUIRED: { text: 'Sign-in required to sync', color: colors.bad },
};

export function SyncStatusCard({ snap, online }: { snap: SyncSnapshot | null; online: boolean }) {
  const s = snap ? LABEL[snap.status] : LABEL[online ? 'PENDING' : 'OFFLINE'];
  return (
    <Card title="Synchronisation">
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: s.color, fontWeight: '700', fontSize: 16 }}
      >
        {online ? s.text : LABEL.OFFLINE.text}
      </Text>
      <Row k="Network" v={online ? 'Online' : 'Offline'} />
      <Row k="Queued events" v={snap?.pendingEvents ?? '—'} />
      <Row k="Queued evidence uploads" v={snap?.pendingEvidence ?? '—'} />
      <Row k="Rejected by server (kept locally)" v={snap?.rejectedEvents ?? '—'} />
      <Row
        k="Last successful sync"
        v={snap?.lastSuccessAt ? new Date(snap.lastSuccessAt).toLocaleString() : 'Never'}
      />
      {snap?.lastError ? <Row k="Last error" v={snap.lastError} /> : null}
      {snap?.serverChainHead ? (
        <Row
          k="Server-acknowledged head"
          v={`#${snap.serverChainHead.sequence} ${snap.serverChainHead.eventHash.slice(0, 12)}…`}
          mono
        />
      ) : null}
    </Card>
  );
}
