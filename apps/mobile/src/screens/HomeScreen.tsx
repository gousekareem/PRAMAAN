import { useCallback, useEffect, useState } from 'react';
import { AppState, RefreshControl, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useServices } from '../app/ServicesContext';
import { Button, Card, Notice, Row, styles } from '../components/ui';
import { SyncStatusCard } from '../components/SyncStatusCard';
import type { SyncSnapshot } from '../sync/syncEngine';
import type { DutyInfo } from '../services/container';
import { Duty } from '../native/modules';
import { appConfig } from '../services/config';
import type { RootStack } from '../navigation/types';

export function HomeScreen({ navigation }: NativeStackScreenProps<RootStack, 'Home'>) {
  const s = useServices();
  const [snap, setSnap] = useState<SyncSnapshot | null>(null);
  const [duties, setDuties] = useState<DutyInfo[]>([]);
  const [active, setActive] = useState<Record<string, string | number | null> | undefined>();
  const [deviceStatus, setDeviceStatus] = useState('…');
  const [next, setNext] = useState<
    { checkinId: string; scheduledFor: string; deadlineAt: string; state: string } | undefined
  >();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setSnap(await s.tick());
      setDeviceStatus(await s.deviceStatus());
      const a = await s.activeDuty();
      setActive(a);
      setNext(a ? await s.checkins.outstanding(String(a.id)) : undefined);
      if (s.online) setDuties(await s.assignedDuties().catch(() => []));
      const launched = await Duty()
        .consumeLaunchCheckin()
        .catch(() => null);
      if (launched) navigation.navigate('Checkin', { checkinId: launched });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [s, navigation]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), appConfig.syncIntervalMs);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void refresh());
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [refresh]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
    >
      <Text style={styles.h1}>
        {s.identity?.displayName}
        {s.identity?.isDemo ? ' (DEMO)' : ''}
      </Text>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {deviceStatus !== 'ACTIVE' ? (
        <Card title="Device registration">
          <Text style={styles.p}>
            Status: {deviceStatus}. Events are recorded locally but the server accepts them only
            after an administrator approves this device.
          </Text>
          {deviceStatus === 'UNREGISTERED' ? (
            <Button title="Register this device" onPress={() => navigation.navigate('Register')} />
          ) : null}
        </Card>
      ) : null}
      <Card title="Duty session">
        {active ? (
          <>
            {active.assignment_json ? (
              <Row
                k="Duty"
                v={(() => {
                  try {
                    const a = JSON.parse(String(active.assignment_json)) as { categoryLabel: string; referenceCode: string };
                    return `${a.categoryLabel} · ${a.referenceCode}`;
                  } catch {
                    return '—';
                  }
                })()}
              />
            ) : null}
            <Row k="Status" v="Active — duty monitoring notification is shown" />
            <Row k="Planned end" v={new Date(String(active.planned_end)).toLocaleString()} />
            <Row
              k="Next check-in (device clock)"
              v={next ? new Date(next.scheduledFor).toLocaleTimeString() : 'Not scheduled'}
            />
            {next?.state === 'PRESENTED' ||
            (next && Date.parse(next.scheduledFor) <= Date.now()) ? (
              <Button
                title="Respond to check-in now"
                onPress={() => navigation.navigate('Checkin', { checkinId: next.checkinId })}
              />
            ) : null}
            <Button
              title="Capture evidence (in-app camera)"
              onPress={() => navigation.navigate('Capture')}
            />
            <Button
              kind="danger"
              title="End duty session"
              busy={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await s.endDuty();
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </>
        ) : duties.length ? (
          duties.map((d) => {
            const a = d.assignment;
            const time = `${new Date(d.plannedStart).toLocaleString()} – ${new Date(d.plannedEnd).toLocaleTimeString()}`;
            const mustAccept = !!a && a.acceptRequired && a.personnelStatus === 'ASSIGNED';
            return (
              <Card key={d.id} title={a ? `${a.categoryLabel} · ${a.referenceCode}` : 'Individual duty session'}>
                {a ? <Text style={styles.p}>{a.title}</Text> : null}
                <Row k="Planned" v={time} />
                {a?.reportingLocation ? <Row k="Report to" v={a.reportingLocation} /> : null}
                {a?.trainRef ? <Row k="Train / service" v={a.trainRef} /> : null}
                {a?.escortLabel ? <Row k="Escort" v={a.escortLabel} /> : null}
                {a?.incidentRef ? <Row k="Incident ref." v={a.incidentRef} /> : null}
                {a ? (
                  <Row
                    k="Check-ins"
                    v={`every ${a.checkinPolicy.minIntervalMin}–${a.checkinPolicy.maxIntervalMin} min, respond within ${a.checkinPolicy.responseWindowSec}s`}
                  />
                ) : (
                  <Row k="Zones" v={d.zones.map((z) => z.code).join(', ') || '—'} />
                )}
                {a?.instructions ? (
                  <>
                    <Text style={styles.p}>
                      Instructions v{a.instructions.version}: {a.instructions.body}
                    </Text>
                    {!a.instructions.acknowledged ? (
                      <Button
                        kind="secondary"
                        title={`Acknowledge instructions v${a.instructions.version}`}
                        onPress={async () => {
                          try {
                            await s.acknowledgeInstructions(a.instructions!.id);
                            await refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      />
                    ) : (
                      <Notice tone="ok">Instructions acknowledged.</Notice>
                    )}
                  </>
                ) : null}
                {mustAccept ? (
                  <Button
                    title="Accept assignment"
                    onPress={async () => {
                      try {
                        await s.acceptAssignment(a!.id);
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                ) : null}
                <Button
                  title="Start duty"
                  busy={busy}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await s.startDuty(d.id);
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </Card>
            );
          })
        ) : (
          <Text style={styles.p}>
            No assigned duty sessions
            {s.online ? '' : ' (offline — connect to download assignments)'}.
          </Text>
        )}
      </Card>
      <SyncStatusCard snap={snap} online={s.online} />
      <Button kind="secondary" title="Sync now" onPress={() => void refresh()} />
      <Button kind="secondary" title="Evidence" onPress={() => navigation.navigate('Evidence')} />
      <Button kind="secondary" title="Local ledger" onPress={() => navigation.navigate('Ledger')} />
      <Button
        kind="secondary"
        title="Permissions & device"
        onPress={() => navigation.navigate('Settings')}
      />
    </ScrollView>
  );
}
