import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useServices } from '../app/ServicesContext';
import { Button, Notice, Row, styles } from '../components/ui';
import type { RootStack } from '../navigation/types';

export function RegisterScreen({ navigation }: NativeStackScreenProps<RootStack, 'Register'>) {
  const s = useServices();
  const [label, setLabel] = useState('Duty phone');
  const [res, setRes] = useState<{ status: string; keyFingerprint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.p}>
        A signing key is generated inside Android Keystore (hardware-backed where the phone supports
        it). Only the public key is sent to the server.
      </Text>
      <TextInput
        accessibilityLabel="Device label"
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        maxLength={80}
      />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button
        title="Generate key and register"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            setRes(await s.registerDevice(label));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {res ? (
        <>
          <Notice tone="info">
            Registered with status {res.status}. Read this fingerprint to the administrator so they
            can verify it before approving.
          </Notice>
          <Row k="Key fingerprint (SHA-256)" v={res.keyFingerprint} mono />
          <Button kind="secondary" title="Done" onPress={() => navigation.goBack()} />
        </>
      ) : null}
    </ScrollView>
  );
}
