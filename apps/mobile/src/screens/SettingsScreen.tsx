import { useEffect, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, ScrollView, Text } from 'react-native';
import { useServices } from '../app/ServicesContext';
import { Button, Card, Notice, Row, styles } from '../components/ui';
import { Duty, Evidence, Security } from '../native/modules';

const PERMS = [
  PermissionsAndroid.PERMISSIONS.CAMERA,
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
].filter(Boolean);

export function SettingsScreen() {
  const s = useServices();
  const [perm, setPerm] = useState<Record<string, string>>({});
  const [exact, setExact] = useState<boolean | null>(null);
  const [battery, setBattery] = useState<boolean | null>(null);
  const [bio, setBio] = useState<string>('…');
  const [posture, setPosture] = useState<Record<string, unknown> | null>(null);
  const [storage, setStorage] = useState<{
    sealedFiles: number;
    sealedBytes: number;
    freeBytes: number;
  } | null>(null);
  const load = async () => {
    const r: Record<string, string> = {};
    for (const p of PERMS) r[p] = (await PermissionsAndroid.check(p)) ? 'granted' : 'not granted';
    setPerm(r);
    setExact(await Duty().canScheduleExactAlarms());
    setBattery(await Duty().isIgnoringBatteryOptimizations());
    setBio(await Security().biometricStatus());
    setPosture(await Security().devicePosture());
    setStorage(await Evidence().storageStats());
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card title="Permissions">
        {Object.entries(perm).map(([k, v]) => (
          <Row key={k} k={k.replace('android.permission.', '')} v={v} />
        ))}
        <Button
          title="Request permissions"
          onPress={async () => {
            if (Platform.OS === 'android') await PermissionsAndroid.requestMultiple(PERMS);
            await load();
          }}
        />
        <Text style={styles.small}>
          Background location is not requested: collection happens only inside the visible
          foreground duty service.
        </Text>
      </Card>
      <Card title="Background execution">
        <Row
          k="Exact alarms allowed"
          v={exact === null ? '…' : exact ? 'Yes' : 'No (check-ins may be delayed)'}
        />
        <Row k="Battery optimisation exempt" v={battery === null ? '…' : battery ? 'Yes' : 'No'} />
        <Button
          kind="secondary"
          title="Allow exact alarms"
          onPress={() => void Duty().openExactAlarmSettings()}
        />
        <Button
          kind="secondary"
          title="Battery optimisation settings"
          onPress={() => void Duty().openBatteryOptimizationSettings()}
        />
        <Notice tone="info">
          Android may still stop the app (force-stop, OEM battery managers, low memory). PRAMAAN
          records service restarts and missed check-ins instead of assuming it ran.
        </Notice>
      </Card>
      <Card title="Device security (heuristic)">
        <Row k="Biometric" v={bio} />
        {posture
          ? Object.entries(posture).map(([k, v]) => (
              <Row
                key={k}
                k={k}
                v={Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v)}
              />
            ))
          : null}
        <Text style={styles.small}>
          Root and emulator checks can be bypassed on a compromised device; they are recorded for
          review, not trusted.
        </Text>
      </Card>
      <Card title="Local storage">
        <Row k="Encrypted evidence files" v={storage?.sealedFiles ?? '…'} />
        <Row
          k="Evidence bytes"
          v={storage ? `${(storage.sealedBytes / 1048576).toFixed(1)} MiB` : '…'}
        />
        <Row k="Free space" v={storage ? `${(storage.freeBytes / 1048576).toFixed(0)} MiB` : '…'} />
        {storage && storage.freeBytes < 200 * 1048576 ? (
          <Notice tone="warn">
            Low storage: synchronise to allow verified evidence to be released.
          </Notice>
        ) : null}
      </Card>
      <Button kind="danger" title="Sign out" onPress={() => void s.session.logout()} />
      <Text style={styles.small}>
        © 2026 SHAIK GOUSE KAREEM. All Rights Reserved. Academic prototype — not endorsed by Guntur
        Railway Police.
      </Text>
      <Text
        accessibilityRole="link"
        style={[styles.small, { textDecorationLine: 'underline' }]}
        onPress={() => void Linking.openURL('https://www.linkedin.com/in/gousekareem/')}
      >
        Developed by SHAIK GOUSE KAREEM · LinkedIn ↗
      </Text>
    </ScrollView>
  );
}
