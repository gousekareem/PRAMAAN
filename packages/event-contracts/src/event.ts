import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { canonicalize, utf8Encode } from './canonical';

export const EVENT_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

/** previous_event_hash of the first event in a device chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** Domain-separation prefix for device signatures over event hashes. */
export const EVENT_SIGNATURE_DOMAIN = 'PRAMAAN-EVENT-V1:';

export const EVENT_TYPES = [
  'DUTY_SESSION_STARTED',
  'DUTY_SESSION_ENDED',
  'CHECKIN_SCHEDULED',
  'CHECKIN_PRESENTED',
  'BIOMETRIC_SUCCESS',
  'BIOMETRIC_FAILURE',
  'COGNITIVE_CHALLENGE_SUCCESS',
  'COGNITIVE_CHALLENGE_FAILURE',
  'CHECKIN_ACKNOWLEDGED',
  'CHECKIN_MISSED',
  'CHECKIN_ACKNOWLEDGED_LATE',
  'EVIDENCE_CAPTURED',
  'LOCATION_OBSERVED',
  'STEP_MILESTONE',
  'MOTION_STATE_CHANGED',
  'TRANSIT_STATE_SUSPECTED',
  'SENSOR_UNAVAILABLE',
  'SENSOR_PERMISSION_REVOKED',
  'LOCATION_MOCK_INDICATOR',
  'CLOCK_ANOMALY_DETECTED',
  'MOVEMENT_EVIDENCE_INCONSISTENCY',
  'DEVICE_INTEGRITY_OBSERVED',
  'SERVICE_LIFECYCLE',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type TrustedTimeSource = 'SERVER_ANCHOR_MONOTONIC' | 'DEVICE_WALL_CLOCK_UNANCHORED';

/**
 * Immutable, hashed portion of a ledger event. Mutable synchronization fields
 * (sync_state, retry_count, server_received_at) are deliberately NOT part of this
 * structure so that historical hashes never change.
 */
export interface EventBody {
  schemaVersion: number;
  eventId: string;
  eventType: EventType;
  officerId: string;
  dutySessionId: string | null;
  deviceId: string;
  deviceSequenceNumber: number;
  /** Device wall-clock time (ISO-8601, UTC, millisecond precision). NOT trusted. */
  deviceWallTime: string;
  /** android.os.SystemClock.elapsedRealtime() at the moment of recording. */
  monotonicElapsedMs: number;
  /** Identifies a device boot; monotonic values are only comparable within one boot. */
  bootId: string;
  /** Best estimate of true time derived from the last server anchor (may be null). */
  trustedTimeEstimate: string | null;
  trustedTimeUncertaintyMs: number | null;
  trustedTimeSource: TrustedTimeSource;
  payload: Record<string, unknown>;
  previousEventHash: string;
}

export interface SignedEvent extends EventBody {
  eventHash: string;
  /** Base64 DER ECDSA-P256-SHA256 signature over EVENT_SIGNATURE_DOMAIN + eventHash. */
  deviceSignature: string | null;
}

export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  return bytesToHex(sha256(bytes));
}

/** Builds the exact object whose canonical form is hashed. Field list is fixed (v1). */
export function hashableEventBody(e: EventBody): Record<string, unknown> {
  return {
    schemaVersion: e.schemaVersion,
    eventId: e.eventId,
    eventType: e.eventType,
    officerId: e.officerId,
    dutySessionId: e.dutySessionId,
    deviceId: e.deviceId,
    deviceSequenceNumber: e.deviceSequenceNumber,
    deviceWallTime: e.deviceWallTime,
    monotonicElapsedMs: e.monotonicElapsedMs,
    bootId: e.bootId,
    trustedTimeEstimate: e.trustedTimeEstimate,
    trustedTimeUncertaintyMs: e.trustedTimeUncertaintyMs,
    trustedTimeSource: e.trustedTimeSource,
    payload: e.payload,
    previousEventHash: e.previousEventHash,
  };
}

export function canonicalEventString(e: EventBody): string {
  return canonicalize(hashableEventBody(e));
}

export function computeEventHash(e: EventBody): string {
  return sha256Hex(canonicalEventString(e));
}

/** The exact UTF-8 message that a device signs for an event. */
export function eventSignatureMessage(eventHash: string): string {
  return `${EVENT_SIGNATURE_DOMAIN}${eventHash}`;
}

export const HEX64 = /^[0-9a-f]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isHex64(v: unknown): v is string {
  return typeof v === 'string' && HEX64.test(v);
}
