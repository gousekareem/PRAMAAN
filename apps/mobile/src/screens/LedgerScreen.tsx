import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { SignedEvent } from '@pramaan/event-contracts';
import { useServices } from '../app/ServicesContext';
import { Card, Notice, Row, styles } from '../components/ui';

export function LedgerScreen() {
  const s = useServices();
  const [events, setEvents] = useState<SignedEvent[]>([]);
  const [verify, setVerify] = useState<Awaited<ReturnType<typeof s.ledger.verifyLocal>> | null>(
    null,
  );
  useEffect(() => {
    void s.ledger.recent(40).then(setEvents);
    void s.ledger.verifyLocal().then(setVerify);
  }, [s]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {verify ? (
        <Notice tone={verify.ok ? 'ok' : 'bad'}>
          {verify.ok
            ? `Local chain consistent (${verify.checked} retained events). Consistency alone does not prove the chain was never rewritten; the server-acknowledged head is the trusted anchor.`
            : `Local chain issues: ${verify.issues.map((i) => i.code).join(', ')}`}
        </Notice>
      ) : null}
      {events.map((e) => (
        <Card key={e.eventId}>
          <Text style={{ fontWeight: '600' }}>
            #{e.deviceSequenceNumber} {e.eventType}
          </Text>
          <Row k="Device time" v={e.deviceWallTime} />
          <Row k="Trusted estimate" v={e.trustedTimeEstimate ?? 'unanchored'} />
          <Row k="Hash" v={e.eventHash} mono />
          <Row k="Previous" v={e.previousEventHash} mono />
        </Card>
      ))}
    </ScrollView>
  );
}
