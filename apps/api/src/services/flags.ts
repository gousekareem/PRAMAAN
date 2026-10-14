import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { EventBus } from '../events/bus.js';

export type FlagType =
  | 'CHECKIN_MISSED'
  | 'CHECKIN_LATE'
  | 'CLOCK_ANOMALY'
  | 'MOCK_LOCATION_INDICATOR'
  | 'EVIDENCE_HASH_MISMATCH'
  | 'INVALID_DEVICE_SIGNATURE'
  | 'SEQUENCE_GAP'
  | 'CHAIN_LINK_MISMATCH'
  | 'EVENT_CONFLICT'
  | 'SPATIAL_ZONE_EXCEPTION'
  | 'MOVEMENT_INCONSISTENCY'
  | 'DEVICE_REGISTRATION'
  | 'DEVICE_REVOCATION'
  | 'DEVICE_INTEGRITY'
  | 'SCREEN_RECAPTURE_RISK';

export interface FlagInput {
  type: FlagType;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  title: string;
  description: string;
  dedupeKey: string;
  officerId?: string | null;
  deviceId?: string | null;
  dutySessionId?: string | null;
  eventId?: string | null;
  evidenceId?: string | null;
  inputs?: Record<string, unknown>;
}

/** Creates a review flag (idempotent via dedupe_key). Flags are prompts for human review only. */
export async function raiseFlag(
  c: pg.PoolClient,
  bus: EventBus | null,
  f: FlagInput,
): Promise<string | null> {
  const id = randomUUID();
  const { rowCount } = await c.query(
    `INSERT INTO review_flags (id, flag_type, severity, title, description, officer_id, device_id, duty_session_id, event_id, evidence_id, inputs, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      id,
      f.type,
      f.severity,
      f.title,
      f.description,
      f.officerId ?? null,
      f.deviceId ?? null,
      f.dutySessionId ?? null,
      f.eventId ?? null,
      f.evidenceId ?? null,
      JSON.stringify(f.inputs ?? {}),
      f.dedupeKey,
    ],
  );
  if (rowCount && bus) {
    const at = new Date().toISOString();
    // published after commit by the caller's flow is preferable; the bus is best-effort only.
    setImmediate(() =>
      bus.publish({ type: 'flag-created', flagId: id, flagType: f.type, severity: f.severity, at }),
    );
  }
  return rowCount ? id : null;
}
