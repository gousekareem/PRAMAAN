import { NativeModules, Platform } from 'react-native';
import type {
  ManifestCellObservation,
  ManifestLocation,
  EvidenceManifest,
} from '@pramaan/event-contracts';
import type { CaptureResult, EvidenceNative, SealResult } from '../evidence/evidenceService';
import type { NativeObservation } from '../sensors/observationProcessor';
import type { ClockSampleNow, DeviceClock, DeviceSigner } from '../types/platform';
import type { AlarmScheduler } from '../checkins/checkinEngine';

/**
 * Typed bridges to the Kotlin modules in android/app/src/main/java/com/pramaan/mobile/.
 * If a module is missing (e.g. running on an unsupported platform) calls fail loudly —
 * there is no simulated fallback in the production app.
 */
function requireModule<T>(name: string): T {
  const m = (NativeModules as Record<string, unknown>)[name];
  if (!m)
    throw new Error(
      `Native module ${name} is not available on ${Platform.OS}. PRAMAAN requires the Android build.`,
    );
  return m as T;
}

interface SecurityModule {
  clock(): Promise<ClockSampleNow>;
  ensureDeviceKey(): Promise<{ publicKeySpki: string; hardwareBacked: boolean | null }>;
  sign(message: string): Promise<string>;
  getOrCreateDatabaseKey(): Promise<string>;
  biometricSign(
    title: string,
    subtitle: string,
    nonce: string,
  ): Promise<{ authenticator: 'BIOMETRIC_STRONG'; signature: string }>;
  biometricStatus(): Promise<
    'AVAILABLE' | 'NONE_ENROLLED' | 'NO_HARDWARE' | 'UNAVAILABLE' | 'SECURITY_UPDATE_REQUIRED'
  >;
  devicePosture(): Promise<
    EvidenceManifest['devicePosture'] & { playIntegrityVerdict: string | null }
  >;
  randomBytesHex(n: number): Promise<string>;
}

interface EvidenceModule {
  capture(): Promise<CaptureResult>;
  seal(tempPath: string): Promise<SealResult>;
  lumaThumbnail(
    sealedPath: string,
    size: number,
  ): Promise<{ width: number; height: number; base64: string }>;
  openForUpload(sealedPath: string, expectedSha256: string): Promise<string>;
  deleteTemp(path: string): Promise<void>;
  discardSealed(path: string): Promise<void>;
  storageStats(): Promise<{ sealedFiles: number; sealedBytes: number; freeBytes: number }>;
}

interface DutyModule {
  startDutyService(dutySessionId: string, plannedEndMs: number): Promise<void>;
  stopDutyService(): Promise<void>;
  isServiceRunning(): Promise<boolean>;
  peekObservations(max: number): Promise<string>;
  removeObservations(count: number): Promise<void>;
  currentLocation(timeoutMs: number): Promise<ManifestLocation>;
  cellInfo(): Promise<{
    availability: 'AVAILABLE' | 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'NOT_SUPPORTED';
    observations: ManifestCellObservation[];
  }>;
  stepsSinceBoot(): Promise<number | null>;
  scheduleCheckinAlarm(
    checkinId: string,
    triggerAtWallMs: number,
    deadlineWallMs: number,
  ): Promise<void>;
  cancelCheckinAlarm(): Promise<void>;
  consumeLaunchCheckin(): Promise<string | null>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<void>;
}

export const Security = () => requireModule<SecurityModule>('PramaanSecurity');
export const Evidence = () => requireModule<EvidenceModule>('PramaanEvidence');
export const Duty = () => requireModule<DutyModule>('PramaanDuty');

export const nativeClock: DeviceClock = { now: () => Security().clock() };
export const nativeSigner: DeviceSigner = { sign: (m) => Security().sign(m) };

export const nativeEvidence: EvidenceNative = {
  capture: () => Evidence().capture(),
  seal: (p) => Evidence().seal(p),
  lumaThumbnail: (p, s) => Evidence().lumaThumbnail(p, s),
  discardSealed: (p) => Evidence().discardSealed(p),
};

export const nativeAlarms: AlarmScheduler = {
  schedule: (id, at, deadline) => Duty().scheduleCheckinAlarm(id, at, deadline),
  cancel: () => Duty().cancelCheckinAlarm(),
};

/**
 * At-least-once drain of the native observation buffer: entries are removed only after
 * `persist` resolved (i.e. after they were written to the encrypted ledger).
 */
export async function drainNativeObservations(
  persist: (obs: NativeObservation[]) => Promise<unknown>,
  max = 500,
): Promise<number> {
  const parsed = JSON.parse(await Duty().peekObservations(max)) as unknown;
  const obs = Array.isArray(parsed) ? (parsed as NativeObservation[]) : [];
  if (!obs.length) return 0;
  await persist(obs);
  await Duty().removeObservations(obs.length);
  return obs.length;
}
