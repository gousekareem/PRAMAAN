import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useServices } from '../app/ServicesContext';
import { Button, Notice, styles, colors } from '../components/ui';
import {
  evaluateChallenge,
  generateChallenge,
  DEFAULT_POLICY,
  type Challenge,
} from '../checkins/checkinEngine';
import { Security } from '../native/modules';
import { secureRandom } from '../services/container';
import type { RootStack } from '../navigation/types';

type Phase = 'BIOMETRIC' | 'CHALLENGE' | 'DONE';

/**
 * Check-in flow: (1) Android BiometricPrompt (BIOMETRIC_STRONG) unlocks a Keystore key that
 * signs a nonce — the biometric itself never leaves the secure hardware; (2) a random
 * three-digit code must be typed within 5 s (attention check, not identity proof).
 */
export function CheckinScreen({ route, navigation }: NativeStackScreenProps<RootStack, 'Checkin'>) {
  const s = useServices();
  const { checkinId } = route.params;
  const [phase, setPhase] = useState<Phase>('BIOMETRIC');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [input, setInput] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [left, setLeft] = useState(DEFAULT_POLICY.challengeLimitMs);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void s.checkins.markPresented(checkinId, 'APP_FOREGROUND');
  }, [s, checkinId]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  async function biometric() {
    const nonceHex = await Security().randomBytesHex(16);
    try {
      const r = await Security().biometricSign(
        'PRAMAAN check-in',
        'Confirm you are the assigned officer',
        nonceHex,
      );
      await s.checkins.recordBiometric(checkinId, {
        success: true,
        authenticator: r.authenticator,
        keystoreAttestedSignature: r.signature,
        nonce: nonceHex,
      });
      await startChallenge();
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'BIOMETRIC_ERROR';
      await s.checkins.recordBiometric(checkinId, {
        success: false,
        errorCode: code.slice(0, 64),
        userCancelled: /CANCEL/i.test(code),
      });
      setMsg({
        tone: 'bad',
        text: `Biometric check not completed (${code}). You can retry until the deadline; the attempt was recorded.`,
      });
    }
  }

  async function startChallenge() {
    const now = await Security().clock();
    const c = generateChallenge(secureRandom, now.monotonicMs);
    setChallenge(c);
    setInput('');
    setPhase('CHALLENGE');
    setLeft(DEFAULT_POLICY.challengeLimitMs);
    if (timer.current) clearInterval(timer.current);
    const started = Date.now();
    timer.current = setInterval(
      () => setLeft(Math.max(0, DEFAULT_POLICY.challengeLimitMs - (Date.now() - started))),
      100,
    );
  }

  async function submit() {
    if (!challenge) return;
    if (timer.current) clearInterval(timer.current);
    const now = await Security().clock();
    const n = attempts + 1;
    setAttempts(n);
    const result = evaluateChallenge(
      challenge,
      input,
      now.monotonicMs,
      DEFAULT_POLICY.challengeLimitMs,
    );
    const outcome = await s.checkins.completeChallenge(checkinId, result, n);
    if (outcome === 'FAILED') {
      setMsg({
        tone: 'warn',
        text:
          result.reason === 'TIMEOUT'
            ? 'Too slow — a new code will be shown.'
            : 'Incorrect code — a new code will be shown.',
      });
      await startChallenge();
      return;
    }
    setPhase('DONE');
    setMsg({
      tone: outcome === 'ACKNOWLEDGED' ? 'ok' : 'warn',
      text:
        outcome === 'ACKNOWLEDGED'
          ? 'Check-in acknowledged and recorded in the local ledger.'
          : 'Recorded as a LATE acknowledgment. The earlier missed check-in remains on record for review.',
    });
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>Duty check-in</Text>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {phase === 'BIOMETRIC' ? (
        <>
          <Text style={styles.p}>
            Step 1 of 2: confirm with your fingerprint or face. Biometric data is checked by Android
            and never stored by PRAMAAN.
          </Text>
          <Button title="Verify biometric" onPress={() => void biometric()} />
        </>
      ) : null}
      {phase === 'CHALLENGE' && challenge ? (
        <>
          <Text style={styles.p}>Step 2 of 2: type this code within 5 seconds.</Text>
          <View
            accessible
            accessibilityLabel={`Code ${challenge.code.split('').join(' ')}`}
            style={{
              alignItems: 'center',
              padding: 16,
              backgroundColor: colors.white,
              borderRadius: 8,
            }}
          >
            <Text style={{ fontSize: 56, fontWeight: '700', letterSpacing: 12, color: colors.ink }}>
              {challenge.code}
            </Text>
            <Text style={styles.small}>{(left / 1000).toFixed(1)} s</Text>
          </View>
          <TextInput
            accessibilityLabel="Enter code"
            style={[styles.input, { fontSize: 28, textAlign: 'center' }]}
            keyboardType="number-pad"
            maxLength={3}
            autoFocus
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void submit()}
          />
          <Button title="Submit" disabled={input.length !== 3} onPress={() => void submit()} />
        </>
      ) : null}
      {phase === 'DONE' ? (
        <Button title="Back to duty" onPress={() => navigation.goBack()} />
      ) : null}
    </ScrollView>
  );
}
