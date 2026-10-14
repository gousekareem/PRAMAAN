import { z } from 'zod';
import { EVENT_TYPES, SUPPORTED_SCHEMA_VERSIONS, type EventType } from '@pramaan/event-contracts';

export const MAX_BATCH_EVENTS = 200;

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'must be a lowercase UUID',
  );
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'must be lowercase hex SHA-256');
const isoTime = z
  .string()
  .max(40)
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
      !Number.isNaN(Date.parse(v)),
    'must be an ISO-8601 timestamp',
  );
const lat = z.number().finite().min(-90).max(90);
const lon = z.number().finite().min(-180).max(180);
const accuracy = z.number().finite().min(0).max(100_000).nullable();
const shortText = z.string().max(200);
const availability = z.enum(['AVAILABLE', 'UNAVAILABLE', 'PERMISSION_DENIED', 'NOT_SUPPORTED']);

export const manifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    evidenceId: uuid,
    officerId: uuid,
    dutySessionId: uuid,
    deviceId: uuid,
    appVersion: shortText,
    capture: z
      .object({
        deviceWallTime: isoTime,
        monotonicElapsedMs: z.number().int().nonnegative(),
        bootId: shortText,
        trustedTimeEstimate: isoTime.nullable(),
        trustedTimeUncertaintyMs: z.number().int().nonnegative().nullable(),
        cameraId: shortText.nullable(),
        captureProvenance: z.literal('IN_APP_CAMERA'),
        captureApi: shortText,
      })
      .strict(),
    image: z
      .object({
        mimeType: z.literal('image/jpeg'),
        byteLength: z
          .number()
          .int()
          .positive()
          .max(8 * 1024 * 1024),
        width: z.number().int().min(64).max(12000),
        height: z.number().int().min(64).max(12000),
        sha256: hex64,
      })
      .strict(),
    location: z
      .object({
        availability,
        latitude: lat.nullable(),
        longitude: lon.nullable(),
        horizontalAccuracyM: accuracy,
        observedAtDeviceTime: isoTime.nullable(),
        fixAgeMs: z.number().int().nonnegative().nullable(),
        provider: shortText.nullable(),
        speedMps: z.number().finite().min(0).max(200).nullable(),
        mockIndicator: z.boolean().nullable(),
        mockIndicatorSource: shortText.nullable(),
      })
      .strict(),
    cellular: z
      .object({
        availability,
        observations: z
          .array(
            z
              .object({
                radio: shortText,
                registered: z.boolean(),
                mcc: z.string().max(3).nullable(),
                mnc: z.string().max(3).nullable(),
                areaCode: z.number().int().nullable(),
                cellId: z.number().int().nullable(),
                signalDbm: z.number().int().min(-200).max(0).nullable(),
              })
              .strict(),
          )
          .max(16),
      })
      .strict(),
    motion: z
      .object({
        stepCounterAvailability: availability,
        stepsSinceBoot: z.number().int().nonnegative().nullable(),
        stepsSinceDutyStart: z.number().int().nonnegative().nullable(),
        motionState: shortText.nullable(),
      })
      .strict(),
    devicePosture: z
      .object({
        debuggableBuild: z.boolean().nullable(),
        rootIndicators: z.array(shortText).max(32),
        developerOptionsEnabled: z.boolean().nullable(),
        adbEnabled: z.boolean().nullable(),
        emulatorIndicators: z.array(shortText).max(32),
        appSigningCertSha256: hex64.nullable(),
        keyHardwareBacked: z.boolean().nullable(),
      })
      .strict(),
    screenRecaptureRisk: z
      .object({
        experimental: z.literal(true),
        score: z.number().min(0).max(1).nullable(),
        method: shortText,
      })
      .strict(),
    derivatives: z
      .array(
        z
          .object({
            kind: z.literal('WATERMARKED_PREVIEW'),
            sha256: hex64,
            byteLength: z.number().int().positive(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

const checkinRef = { checkinId: uuid };
const sensorName = z.enum([
  'STEP_COUNTER',
  'ACCELEROMETER',
  'LOCATION',
  'CAMERA',
  'CELLULAR',
  'BIOMETRIC',
  'NOTIFICATIONS',
  'EXACT_ALARM',
]);

export const payloadSchemas: Record<EventType, z.ZodType> = {
  DUTY_SESSION_STARTED: z
    .object({ assignedZoneIds: z.array(uuid).max(20), startedVia: z.enum(['APP', 'RECOVERY']) })
    .strict(),
  DUTY_SESSION_ENDED: z
    .object({ reason: z.enum(['OFFICER_ENDED', 'DUTY_EXPIRED', 'SUPERVISOR_ENDED', 'LOGOUT']) })
    .strict(),
  CHECKIN_SCHEDULED: z
    .object({
      ...checkinRef,
      scheduledFor: isoTime,
      deadlineAt: isoTime,
      intervalMs: z.number().int().positive(),
      responseWindowMs: z.number().int().positive(),
      policyVersion: z.number().int().positive(),
    })
    .strict(),
  CHECKIN_PRESENTED: z
    .object({
      ...checkinRef,
      presentedVia: z.enum(['NOTIFICATION', 'FULL_SCREEN_INTENT', 'APP_FOREGROUND']),
    })
    .strict(),
  BIOMETRIC_SUCCESS: z
    .object({
      ...checkinRef,
      authenticator: z.enum(['BIOMETRIC_STRONG', 'BIOMETRIC_WEAK', 'DEVICE_CREDENTIAL']),
      keystoreAttestedSignature: z.string().max(200).nullable(),
      challengeNonce: z.string().max(64),
    })
    .strict(),
  BIOMETRIC_FAILURE: z
    .object({ ...checkinRef, errorCode: z.string().max(64), userCancelled: z.boolean() })
    .strict(),
  COGNITIVE_CHALLENGE_SUCCESS: z
    .object({
      ...checkinRef,
      elapsedMs: z.number().int().nonnegative(),
      limitMs: z.number().int().positive(),
      attempts: z.number().int().positive(),
    })
    .strict(),
  COGNITIVE_CHALLENGE_FAILURE: z
    .object({
      ...checkinRef,
      elapsedMs: z.number().int().nonnegative(),
      limitMs: z.number().int().positive(),
      attempts: z.number().int().positive(),
      reason: z.enum(['WRONG_CODE', 'TIMEOUT']),
    })
    .strict(),
  CHECKIN_ACKNOWLEDGED: z
    .object({
      ...checkinRef,
      scheduledFor: isoTime,
      deadlineAt: isoTime,
      acknowledgedAtDevice: isoTime,
      responseMs: z.number().int().nonnegative(),
    })
    .strict(),
  CHECKIN_ACKNOWLEDGED_LATE: z
    .object({
      ...checkinRef,
      scheduledFor: isoTime,
      deadlineAt: isoTime,
      acknowledgedAtDevice: isoTime,
      lateByMs: z.number().int().positive(),
      missedEventId: uuid.nullable(),
    })
    .strict(),
  CHECKIN_MISSED: z
    .object({
      ...checkinRef,
      scheduledFor: isoTime,
      deadlineAt: isoTime,
      detectedAtDevice: isoTime,
      reasonCode: z.enum([
        'NO_RESPONSE',
        'BIOMETRIC_FAILED',
        'CHALLENGE_FAILED',
        'APP_NOT_RUNNING',
        'DEVICE_REBOOTED',
        'UNKNOWN',
      ]),
    })
    .strict(),
  EVIDENCE_CAPTURED: z
    .object({
      evidenceId: uuid,
      imageSha256: hex64,
      manifestSha256: hex64,
      manifest: manifestSchema,
    })
    .strict(),
  LOCATION_OBSERVED: z
    .object({
      latitude: lat,
      longitude: lon,
      horizontalAccuracyM: accuracy,
      speedMps: z.number().finite().min(0).max(200).nullable(),
      speedAccuracyMps: z.number().finite().min(0).max(200).nullable(),
      provider: shortText,
      fixDeviceTime: isoTime,
      mockIndicator: z.boolean().nullable(),
      mockIndicatorSource: shortText.nullable(),
    })
    .strict(),
  STEP_MILESTONE: z
    .object({
      stepsSinceBoot: z.number().int().nonnegative(),
      stepsSinceDutyStart: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  MOTION_STATE_CHANGED: z
    .object({ from: shortText, to: shortText, confidence: z.number().min(0).max(1) })
    .strict(),
  TRANSIT_STATE_SUSPECTED: z
    .object({
      state: z.enum(['ENTERED', 'EXITED']),
      speedMps: z.number().min(0).max(200),
      speedAccuracyMps: z.number().min(0).nullable(),
      horizontalAccuracyM: accuracy,
    })
    .strict(),
  SENSOR_UNAVAILABLE: z.object({ sensor: sensorName, reason: shortText }).strict(),
  SENSOR_PERMISSION_REVOKED: z.object({ sensor: sensorName, permission: shortText }).strict(),
  LOCATION_MOCK_INDICATOR: z
    .object({
      indicator: z.boolean(),
      source: shortText,
      latitude: lat.nullable(),
      longitude: lon.nullable(),
    })
    .strict(),
  CLOCK_ANOMALY_DETECTED: z
    .object({
      anomalies: z
        .array(
          z
            .object({
              code: shortText,
              severity: z.enum(['INFO', 'WARNING']),
              detail: shortText,
              deltaMs: z.number().nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  MOVEMENT_EVIDENCE_INCONSISTENCY: z
    .object({ assessment: z.record(z.string(), z.unknown()) })
    .strict(),
  DEVICE_INTEGRITY_OBSERVED: z
    .object({
      debuggableBuild: z.boolean().nullable(),
      rootIndicators: z.array(shortText).max(32),
      developerOptionsEnabled: z.boolean().nullable(),
      adbEnabled: z.boolean().nullable(),
      emulatorIndicators: z.array(shortText).max(32),
      appSigningCertSha256: hex64.nullable(),
      keyHardwareBacked: z.boolean().nullable(),
      playIntegrityVerdict: shortText.nullable(),
    })
    .strict(),
  SERVICE_LIFECYCLE: z
    .object({
      state: z.enum([
        'STARTED',
        'STOPPED',
        'RESTARTED',
        'UNEXPECTED_TERMINATION_DETECTED',
        'BOOT_RECOVERY',
      ]),
      detail: shortText,
    })
    .strict(),
};

export const eventEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int(),
    eventId: uuid,
    eventType: z.enum(EVENT_TYPES),
    officerId: uuid,
    dutySessionId: uuid.nullable(),
    deviceId: uuid,
    deviceSequenceNumber: z.number().int().positive().max(2_000_000_000),
    deviceWallTime: isoTime,
    monotonicElapsedMs: z.number().int().nonnegative(),
    bootId: z.string().min(1).max(64),
    trustedTimeEstimate: isoTime.nullable(),
    trustedTimeUncertaintyMs: z.number().int().nonnegative().nullable(),
    trustedTimeSource: z.enum(['SERVER_ANCHOR_MONOTONIC', 'DEVICE_WALL_CLOCK_UNANCHORED']),
    payload: z.record(z.string(), z.unknown()),
    previousEventHash: hex64,
    eventHash: hex64,
    deviceSignature: z
      .string()
      .min(16)
      .max(200)
      .regex(/^[A-Za-z0-9+/=]+$/)
      .nullable(),
  })
  .strict();

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const syncBatchSchema = z
  .object({
    batchId: uuid,
    schemaVersion: z.number().int(),
    deviceId: uuid,
    events: z.array(z.unknown()).min(1).max(MAX_BATCH_EVENTS),
  })
  .strict();

export type SyncBatch = z.infer<typeof syncBatchSchema>;

export function isSupportedSchemaVersion(v: number): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(v);
}

export interface PayloadValidation {
  ok: boolean;
  issues: string[];
}

export function validatePayload(type: EventType, payload: unknown): PayloadValidation {
  const schema = payloadSchemas[type];
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export { z };
