import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useServices } from '../app/ServicesContext';
import { Button, Notice, styles } from '../components/ui';
import type { RootStack } from '../navigation/types';

export function LoginScreen({ navigation }: NativeStackScreenProps<RootStack, 'Login'>) {
  const s = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>PRAMAAN duty device</Text>
      <Text style={styles.small}>
        Academic prototype. Sign in with your officer account. A network connection is needed once
        to sign in and download duty assignments.
      </Text>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <TextInput
        accessibilityLabel="E-mail"
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        accessibilityLabel="Password"
        style={styles.input}
        secureTextEntry
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
      />
      <Button
        title="Sign in"
        busy={busy}
        disabled={!email || !password}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await s.login(email.trim(), password);
            setPassword('');
            navigation.replace('Home');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </ScrollView>
  );
}
