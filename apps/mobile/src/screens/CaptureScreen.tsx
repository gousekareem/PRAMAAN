import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useServices } from '../app/ServicesContext';
import { Button, Card, Notice, Row, styles } from '../components/ui';
import type { RootStack } from '../navigation/types';

/** Evidence capture. The ONLY entry point is the native in-app camera; there is no gallery or file import. */
export function CaptureScreen({ navigation }: NativeStackScreenProps<RootStack, 'Capture'>) {
  const s = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Awaited<ReturnType<typeof s.evidence.captureEvidence>> | null>(
    null,
  );
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.p}>
        Opens the integrated camera. The photo is hashed (SHA-256), encrypted on the device and
        bound to a signed ledger event together with location, step and device observations.
      </Text>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button
        title="Open camera"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const active = await s.activeDuty();
            if (!active || !s.identity)
              throw new Error('Start a duty session before capturing evidence.');
            setRes(
              await s.evidence.captureEvidence({
                dutySessionId: String(active.id),
                officerId: s.identity.officerId,
                deviceId: s.deviceId,
              }),
            );
          } catch (e) {
            setError(
              (e as Error).message === 'CANCELLED'
                ? 'Capture cancelled; nothing was recorded.'
                : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      {res ? (
        <Card title="Recorded evidence (queued for sync)">
          <Row k="Evidence ID" v={res.evidenceId} mono />
          <Row k="Image SHA-256" v={res.manifest.image.sha256} mono />
          <Row k="Manifest SHA-256" v={res.manifestSha256} mono />
          <Row k="Ledger sequence" v={res.event.deviceSequenceNumber} />
          <Row k="Event hash" v={res.event.eventHash} mono />
          <Row k="Previous hash" v={res.event.previousEventHash} mono />
          <Row k="Device time" v={res.manifest.capture.deviceWallTime} />
          <Row
            k="Trusted-time estimate"
            v={res.manifest.capture.trustedTimeEstimate ?? 'Unanchored (no server time since boot)'}
          />
          <Row
            k="Location"
            v={
              res.manifest.location.availability === 'AVAILABLE'
                ? `${res.manifest.location.latitude?.toFixed(5)}, ${res.manifest.location.longitude?.toFixed(5)} ±${res.manifest.location.horizontalAccuracyM ?? '?'} m`
                : res.manifest.location.availability
            }
          />
          <Row k="Cellular" v={res.manifest.cellular.availability} />
          <Row
            k="Screen re-capture risk (experimental)"
            v={res.manifest.screenRecaptureRisk.score ?? 'n/a'}
          />
          <Text style={styles.small}>
            A hash proves the file is unchanged later; it does not prove the scene is genuine.
          </Text>
          <Button kind="secondary" title="Done" onPress={() => navigation.goBack()} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
