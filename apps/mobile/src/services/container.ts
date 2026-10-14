import NetInfo from '@react-native-community/netinfo';
import type { EvidenceManifest } from '@pramaan/event-contracts';
import { openEncryptedDatabase } from '../storage/opsqlite';
import { runLocalMigrations } from '../storage/migrations';
import type { SqlDatabase } from '../storage/db';
import { LedgerService } from '../ledger/ledger';
import { FetchHttpClient } from '../sync/http';
import { SyncEngine, type SyncSnapshot } from '../sync/syncEngine';
import { compactLedger } from '../sync/retention';
import { CheckinEngine, DEFAULT_POLICY } from '../checkins/checkinEngine';
import { EvidenceService } from '../evidence/evidenceService';
import { ObservationProcessor } from '../sensors/observationProcessor';
import {
  Duty,
  Evidence,
  Security,
  drainNativeObservations,
  nativeAlarms,
  nativeClock,
  nativeEvidence,
  nativeSigner,
} from '../native/modules';
import { uuidV4, type RandomSource } from '../types/platform';
import { Session, type OfficerIdentity } from './session';
import { appConfig } from './config';

export const secureRandom: RandomSource = {
  bytes: (n) => {
    const a = new Uint8Array(n);
    // Polyfilled by react-native-get-random-values (java.security.SecureRandom on Android).
    (
      globalThis as unknown as { crypto: { getRandomValues: (a: Uint8Array) => Uint8Array } }
    ).crypto.getRandomValues(a);
    return a;
  },
};

export interface DutyInfo {
  id: string;
  plannedStart: string;
  plannedEnd: string;
  status: string;
  zones: { id: string; code: string; name: string }[];
}

/** Composition root for the Android app. */
export class AppServices {
  online = false;
  identity: OfficerIdentity | null = null;
  deviceId!: string;
  ledger!: LedgerService;
  sync!: SyncEngine;
  checkins!: CheckinEngine;
  evidence!: EvidenceService;
  private processor!: ObservationProcessor;
  private constructor(
    readonly db: SqlDatabase,
    readonly session: Session,
    readonly http: FetchHttpClient,
  ) {}

  static async bootstrap(): Promise<AppServices> {
    const key = await Security().getOrCreateDatabaseKey();
    const db = await openEncryptedDatabase('pramaan.db', key);
    await runLocalMigrations(db);
    const http = new FetchHttpClient(appConfig.apiBaseUrl);
    const s = new AppServices(db, new Session(db, http), http);
    const idRow = (await db.execute("SELECT value FROM secure_kv WHERE key = 'device_id'")).rows[0];
    s.deviceId = idRow ? String(idRow.value) : uuidV4(secureRandom);
    if (!idRow)
      await db.execute("INSERT INTO secure_kv (key, value) VALUES ('device_id', ?)", [s.deviceId]);
    NetInfo.addEventListener((st) => {
      s.online = !!st.isConnected && st.isInternetReachable !== false;
    });
    s.identity = await s.session.identity();
    if (s.identity) await s.wire(s.identity);
    return s;
  }

  async wire(identity: OfficerIdentity): Promise<void> {
    this.identity = identity;
    this.ledger = new LedgerService(this.db, nativeClock, nativeSigner, secureRandom);
    await this.ledger.initialise(this.deviceId, identity.officerId);
    this.sync = new SyncEngine(
      this.db,
      this.ledger,
      this.http,
      this.session,
      {
        openForUpload: (p, h) => Evidence().openForUpload(p, h),
        deleteTemp: (p) => Evidence().deleteTemp(p),
      },
      nativeClock,
      secureRandom,
    );
    await this.sync.recoverInterrupted();
    this.checkins = new CheckinEngine(
      this.db,
      this.ledger,
      nativeClock,
      secureRandom,
      nativeAlarms,
      DEFAULT_POLICY,
    );
    this.processor = new ObservationProcessor(this.ledger);
    this.evidence = new EvidenceService(
      this.db,
      this.ledger,
      nativeEvidence,
      {
        location: () => Duty().currentLocation(15_000),
        cellular: () => Duty().cellInfo(),
        motion: async (): Promise<EvidenceManifest['motion']> => {
          const steps = await Duty()
            .stepsSinceBoot()
            .catch(() => null);
          const duty = await this.activeDuty();
          return {
            stepCounterAvailability: steps === null ? 'UNAVAILABLE' : 'AVAILABLE',
            stepsSinceBoot: steps,
            stepsSinceDutyStart:
              steps !== null && duty?.step_baseline != null
                ? Math.max(0, steps - Number(duty.step_baseline))
                : null,
            motionState: null,
          };
        },
        posture: async () => {
          const { playIntegrityVerdict: _ignored, ...p } = await Security().devicePosture();
          return p;
        },
        appVersion: appConfig.appVersion,
      },
      nativeClock,
      secureRandom,
    );
  }

  async login(email: string, password: string): Promise<OfficerIdentity> {
    const id = await this.session.login(email, password, this.deviceId);
    await this.wire(id);
    return id;
  }

  /** Registers the device public key (private key stays in Android Keystore). */
  async registerDevice(label: string): Promise<{ status: string; keyFingerprint: string }> {
    const key = await Security().ensureDeviceKey();
    const r = await this.http.send({
      method: 'POST',
      path: '/api/v1/devices/register',
      token: this.session.accessToken(),
      json: {
        deviceId: this.deviceId,
        label,
        platform: 'ANDROID',
        publicKeySpki: key.publicKeySpki,
        keyAlgorithm: 'ECDSA_P256_SHA256',
        keyHardwareBacked: key.hardwareBacked,
        appVersion: appConfig.appVersion,
      },
    });
    const b = r.json as { status?: string; keyFingerprint?: string; error?: { message: string } };
    if (r.status !== 200 && r.status !== 201)
      throw new Error(b.error?.message ?? `Registration failed (HTTP ${r.status})`);
    await this.db.execute('UPDATE device_state SET registration_status = ? WHERE id = 1', [
      b.status ?? 'PENDING',
    ]);
    return { status: b.status ?? 'PENDING', keyFingerprint: b.keyFingerprint ?? '' };
  }

  async deviceStatus(): Promise<string> {
    if (!this.online || !this.session.accessToken())
      return String((await this.ledger.state())?.registration_status ?? 'UNREGISTERED');
    const r = await this.http
      .send({ method: 'GET', path: '/api/v1/devices/mine', token: this.session.accessToken() })
      .catch(() => null);
    const item = (r?.json as { items?: { id: string; status: string }[] } | undefined)?.items?.find(
      (d) => d.id === this.deviceId,
    );
    if (item)
      await this.db.execute('UPDATE device_state SET registration_status = ? WHERE id = 1', [
        item.status,
      ]);
    return (
      item?.status ?? String((await this.ledger.state())?.registration_status ?? 'UNREGISTERED')
    );
  }

  async assignedDuties(): Promise<DutyInfo[]> {
    const r = await this.http.send({
      method: 'GET',
      path: '/api/v1/duties?pageSize=10',
      token: this.session.accessToken(),
    });
    const items = ((r.json as { items?: DutyInfo[] }).items ?? []).filter(
      (d) => d.status === 'PLANNED' || d.status === 'ACTIVE',
    );
    for (const d of items) {
      await this.db.execute(
        `INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, zone_ids_json, status, updated_at) VALUES (?, ?, ?, ?, ?, 'PLANNED', ?)
         ON CONFLICT(id) DO UPDATE SET planned_start = excluded.planned_start, planned_end = excluded.planned_end, zone_ids_json = excluded.zone_ids_json`,
        [
          d.id,
          this.identity!.officerId,
          d.plannedStart,
          d.plannedEnd,
          JSON.stringify(d.zones.map((z) => z.id)),
          new Date().toISOString(),
        ],
      );
    }
    return items;
  }

  async activeDuty() {
    return (await this.db.execute("SELECT * FROM duty_sessions WHERE status = 'ACTIVE' LIMIT 1"))
      .rows[0] as Record<string, string | number | null> | undefined;
  }

  async startDuty(dutyId: string): Promise<void> {
    const d = (await this.db.execute('SELECT * FROM duty_sessions WHERE id = ?', [dutyId])).rows[0];
    if (!d) throw new Error('Duty not downloaded; connect once to fetch assignments');
    const steps = await Duty()
      .stepsSinceBoot()
      .catch(() => null);
    await this.ledger.append(
      'DUTY_SESSION_STARTED',
      { assignedZoneIds: JSON.parse(String(d.zone_ids_json)), startedVia: 'APP' },
      {
        dutySessionId: dutyId,
        alsoInTx: (tx, ev) =>
          tx
            .execute(
              "UPDATE duty_sessions SET status = 'ACTIVE', started_event_id = ?, step_baseline = ?, updated_at = ? WHERE id = ?",
              [ev.eventId, steps, new Date().toISOString(), dutyId],
            )
            .then(() => undefined),
      },
    );
    const posture = await Security().devicePosture();
    await this.ledger.append('DEVICE_INTEGRITY_OBSERVED', posture, { dutySessionId: dutyId });
    await Duty().startDutyService(dutyId, Date.parse(String(d.planned_end)));
    await this.checkins.scheduleNext(dutyId, String(d.planned_end));
  }

  async endDuty(): Promise<void> {
    const d = await this.activeDuty();
    if (!d) return;
    await this.tick();
    await this.checkins.cancelForDuty(String(d.id));
    await this.ledger.append(
      'DUTY_SESSION_ENDED',
      { reason: 'OFFICER_ENDED' },
      {
        dutySessionId: String(d.id),
        alsoInTx: (tx, ev) =>
          tx
            .execute(
              "UPDATE duty_sessions SET status = 'ENDED', ended_event_id = ?, updated_at = ? WHERE id = ?",
              [ev.eventId, new Date().toISOString(), String(d.id)],
            )
            .then(() => undefined),
      },
    );
    await Duty().stopDutyService();
  }

  /** Periodic work while the app is in the foreground or woken by the service. */
  async tick(): Promise<SyncSnapshot | null> {
    if (!this.identity) return null;
    const d = await this.activeDuty();
    if (d) {
      await drainNativeObservations((obs) => this.processor.process(String(d.id), obs), 500);
      await this.checkins.evaluateDeadlines();
      await this.checkins.scheduleNext(String(d.id), String(d.planned_end));
    }
    if (this.online && !this.session.accessToken()) await this.session.refresh();
    const snap = await this.sync.runOnce({ online: this.online, deviceId: this.deviceId });
    await compactLedger(this.db, (p) => Evidence().discardSealed(p)).catch(() => undefined);
    return snap;
  }
}
