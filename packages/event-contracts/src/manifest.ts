import { canonicalize } from './canonical';
import { HEX64, sha256Hex, UUID_RE } from './event';

export const MANIFEST_VERSION = 1 as const;
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_EVIDENCE_MIME = ['image/jpeg'] as const;

/** Explicit availability marker so that missing data is never confused with fabricated data. */
export type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'NOT_SUPPORTED';

export interface ManifestLocation {
  availability: Availability;
  latitude: number | null;
  longitude: number | null;
  horizontalAccuracyM: number | null;
  observedAtDeviceTime: string | null;
  /** Age of the location fix at capture time, from elapsedRealtimeNanos. */
  fixAgeMs: number | null;
  provider: string | null;
  speedMps: number | null;
  /** Location.isMock() (API 31+) / isFromMockProvider(); null when the platform cannot tell. */
  mockIndicator: boolean | null;
  mockIndicatorSource: string | null;
}

export interface ManifestCellObservation {
  radio: string;
  registered: boolean;
  /** Only values actually returned by Android. Redacted/unavailable values are null. */
  mcc: string | null;
  mnc: string | null;
  areaCode: number | null;
  cellId: number | null;
  signalDbm: number | null;
}

export interface EvidenceManifest {
  manifestVersion: number;
  evidenceId: string;
  officerId: string;
  dutySessionId: string;
  deviceId: string;
  appVersion: string;
  capture: {
    deviceWallTime: string;
    monotonicElapsedMs: number;
    bootId: string;
    trustedTimeEstimate: string | null;
    trustedTimeUncertaintyMs: number | null;
    cameraId: string | null;
    captureProvenance: 'IN_APP_CAMERA';
    captureApi: string;
  };
  image: {
    mimeType: string;
    byteLength: number;
    width: number;
    height: number;
    sha256: string;
  };
  location: ManifestLocation;
  cellular: {
    availability: Availability;
    observations: ManifestCellObservation[];
  };
  motion: {
    stepCounterAvailability: Availability;
    stepsSinceBoot: number | null;
    stepsSinceDutyStart: number | null;
    motionState: string | null;
  };
  devicePosture: {
    debuggableBuild: boolean | null;
    rootIndicators: string[];
    developerOptionsEnabled: boolean | null;
    adbEnabled: boolean | null;
    emulatorIndicators: string[];
    appSigningCertSha256: string | null;
    keyHardwareBacked: boolean | null;
  };
  screenRecaptureRisk: {
    experimental: true;
    score: number | null;
    method: string;
  };
  derivatives: { kind: 'WATERMARKED_PREVIEW'; sha256: string; byteLength: number }[];
}

export function computeManifestHash(m: EvidenceManifest): string {
  return sha256Hex(canonicalize(m));
}

export interface ManifestValidationIssue {
  field: string;
  problem: string;
}

function inRange(v: number | null, lo: number, hi: number): boolean {
  return v === null || (Number.isFinite(v) && v >= lo && v <= hi);
}

/** Structural and plausibility validation. Does NOT prove the scene was genuine. */
export function validateManifest(m: EvidenceManifest): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const req = (cond: boolean, field: string, problem: string) => {
    if (!cond) issues.push({ field, problem });
  };
  req(m.manifestVersion === MANIFEST_VERSION, 'manifestVersion', 'unsupported manifest version');
  req(UUID_RE.test(m.evidenceId ?? ''), 'evidenceId', 'must be a UUID');
  req(UUID_RE.test(m.officerId ?? ''), 'officerId', 'must be a UUID');
  req(UUID_RE.test(m.dutySessionId ?? ''), 'dutySessionId', 'must be a UUID');
  req(UUID_RE.test(m.deviceId ?? ''), 'deviceId', 'must be a UUID');
  req(
    m.capture?.captureProvenance === 'IN_APP_CAMERA',
    'capture.captureProvenance',
    'only in-app camera captures are accepted',
  );
  req(
    !Number.isNaN(Date.parse(m.capture?.deviceWallTime ?? '')),
    'capture.deviceWallTime',
    'invalid timestamp',
  );
  req(
    (ALLOWED_EVIDENCE_MIME as readonly string[]).includes(m.image?.mimeType),
    'image.mimeType',
    'unsupported media type',
  );
  req(
    Number.isInteger(m.image?.byteLength) &&
      m.image.byteLength > 0 &&
      m.image.byteLength <= MAX_EVIDENCE_BYTES,
    'image.byteLength',
    'out of range',
  );
  req(
    Number.isInteger(m.image?.width) && m.image.width >= 64 && m.image.width <= 12000,
    'image.width',
    'out of range',
  );
  req(
    Number.isInteger(m.image?.height) && m.image.height >= 64 && m.image.height <= 12000,
    'image.height',
    'out of range',
  );
  req(HEX64.test(m.image?.sha256 ?? ''), 'image.sha256', 'must be lowercase hex SHA-256');
  const loc = m.location;
  if (loc) {
    req(inRange(loc.latitude, -90, 90), 'location.latitude', 'out of range');
    req(inRange(loc.longitude, -180, 180), 'location.longitude', 'out of range');
    req(
      inRange(loc.horizontalAccuracyM, 0, 100000),
      'location.horizontalAccuracyM',
      'out of range',
    );
    if (loc.availability === 'AVAILABLE') {
      req(
        loc.latitude !== null && loc.longitude !== null,
        'location',
        'AVAILABLE location must include coordinates',
      );
    } else {
      req(
        loc.latitude === null && loc.longitude === null,
        'location',
        'coordinates present although marked unavailable',
      );
    }
  } else {
    issues.push({ field: 'location', problem: 'missing' });
  }
  if (m.cellular?.availability !== 'AVAILABLE') {
    req(
      (m.cellular?.observations ?? []).length === 0,
      'cellular',
      'observations present although marked unavailable',
    );
  }
  const score = m.screenRecaptureRisk?.score;
  req(
    score === null || score === undefined || (score >= 0 && score <= 1),
    'screenRecaptureRisk.score',
    'must be within [0,1]',
  );
  return issues;
}
