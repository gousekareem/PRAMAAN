import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { assessMovement, type EvidenceManifest, type SignedEvent } from '@pramaan/event-contracts';
import type { AppContext } from '../context.js';
import { evaluateLocation, type SpatialEvaluation } from '../spatial/zones.js';
import { onDeviceDutyStarted } from '../services/duties.js';
import { raiseFlag } from '../services/flags.js';

type P = Record<string, unknown>;

interface LocationLike {
  latitude: number | null;
  longitude: number | null;
  horizontalAccuracyM: number | null;
  mockIndicator: boolean | null;
  mockIndicatorSource?: string | null;
}

async function insertPatrolLog(
  c: pg.PoolClient,
  e: SignedEvent,
  dutyId: string | null,
  receivedAt: Date,
  loc: LocationLike | null,
  evidenceId: string | null,
  verification: string,
): Promise<SpatialEvaluation> {
  let spatial: SpatialEvaluation = {
    spatialResult: 'NO_LOCATION',
    matchedZoneIds: [],
    distanceToAssignedZoneM: null,
  };
  const hasLoc = loc && loc.latitude !== null && loc.longitude !== null;
  if (hasLoc)
    spatial = await evaluateLocation(
      c,
      loc.longitude!,
      loc.latitude!,
      loc.horizontalAccuracyM,
      dutyId,
      new Date(e.deviceWallTime),
    );
  await c.query(
    `INSERT INTO patrol_logs (id, event_id, officer_id, duty_session_id, device_id, event_type, location, horizontal_accuracy_m,
        recorded_device_time, trusted_time_estimate, server_received_at, evidence_id, verification_status, spatial_result,
        matched_zone_ids, distance_to_assigned_zone_m, mock_indicator)
     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography END,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      randomUUID(),
      e.eventId,
      e.officerId,
      dutyId,
      e.deviceId,
      e.eventType,
      hasLoc ? loc.longitude : null,
      hasLoc ? loc.latitude : null,
      loc?.horizontalAccuracyM ?? null,
      e.deviceWallTime,
      e.trustedTimeEstimate,
      receivedAt,
      evidenceId,
      verification,
      spatial.spatialResult,
      spatial.matchedZoneIds,
      spatial.distanceToAssignedZoneM,
      loc?.mockIndicator ?? null,
    ],
  );
  return spatial;
}

async function spatialAndMockFlags(
  ctx: AppContext,
  c: pg.PoolClient,
  e: SignedEvent,
  dutyId: string | null,
  s: SpatialEvaluation,
  loc: LocationLike,
) {
  if (s.spatialResult === 'OUTSIDE_ASSIGNED_ZONE') {
    const hour = e.deviceWallTime.slice(0, 13);
    await raiseFlag(c, ctx.bus, {
      type: 'SPATIAL_ZONE_EXCEPTION',
      severity: 'LOW',
      title: 'Observation outside assigned patrol zone',
      description: `Location reported ${s.distanceToAssignedZoneM} m outside the assigned zone(s), beyond the reported accuracy. GPS error, re-routing or authorised movement are possible explanations.`,
      dedupeKey: `spatial:${dutyId ?? e.deviceId}:${hour}`,
      officerId: e.officerId,
      deviceId: e.deviceId,
      dutySessionId: dutyId,
      eventId: e.eventId,
      inputs: {
        distanceM: s.distanceToAssignedZoneM,
        accuracyM: loc.horizontalAccuracyM,
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
    });
  }
  if (loc.mockIndicator === true) {
    await raiseFlag(c, ctx.bus, {
      type: 'MOCK_LOCATION_INDICATOR',
      severity: 'MEDIUM',
      title: 'Platform reported a mock-location indicator',
      description:
        'Android reported this fix as coming from a mock provider. The indicator is client-reported and can be absent or manipulated on compromised devices; corroborate with other evidence.',
      dedupeKey: `mock:${dutyId ?? e.deviceId}:${e.deviceWallTime.slice(0, 13)}`,
      officerId: e.officerId,
      deviceId: e.deviceId,
      dutySessionId: dutyId,
      eventId: e.eventId,
      inputs: {
        source: loc.mockIndicatorSource ?? null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        observedAt: e.deviceWallTime,
      },
    });
  }
}

async function upsertCheckin(
  c: pg.PoolClient,
  e: SignedEvent,
  dutyId: string | null,
  patch: Record<string, unknown>,
) {
  const p = e.payload as P;
  const cols = Object.keys(patch);
  const vals = Object.values(patch);
  const setSql = cols.map((k, i) => `${k} = COALESCE($${i + 6}, checkins.${k})`).join(', ');
  await c.query(
    `INSERT INTO checkins (checkin_id, device_id, officer_id, duty_session_id, status, event_ids ${cols.length ? ',' + cols.join(',') : ''})
     VALUES ($1,$2,$3,$4,$5, ARRAY[$${cols.length + 6}::uuid] ${cols.map((_, i) => `,$${i + 6}`).join('')})
     ON CONFLICT (checkin_id) DO UPDATE SET
       status = CASE
         WHEN checkins.status IN ('ACKNOWLEDGED','ACKNOWLEDGED_LATE') THEN checkins.status
         WHEN EXCLUDED.status = 'ACKNOWLEDGED_LATE' THEN 'ACKNOWLEDGED_LATE'
         WHEN checkins.status = 'MISSED' THEN 'MISSED'
         WHEN EXCLUDED.status IN ('ACKNOWLEDGED','MISSED') THEN EXCLUDED.status
         WHEN checkins.status = 'SCHEDULED' THEN EXCLUDED.status
         ELSE checkins.status END,
       event_ids = array_append(checkins.event_ids, $${cols.length + 6}::uuid),
       updated_at = now() ${cols.length ? ', ' + setSql : ''}`,
    [p.checkinId, e.deviceId, e.officerId, dutyId, statusFor(e.eventType), ...vals, e.eventId],
  );
}

function statusFor(t: string): string {
  switch (t) {
    case 'CHECKIN_ACKNOWLEDGED':
      return 'ACKNOWLEDGED';
    case 'CHECKIN_ACKNOWLEDGED_LATE':
      return 'ACKNOWLEDGED_LATE';
    case 'CHECKIN_MISSED':
      return 'MISSED';
    case 'CHECKIN_SCHEDULED':
      return 'SCHEDULED';
    default:
      return 'PRESENTED';
  }
}

/** Builds server-derived records from an accepted original event. Never modifies the event. */
export async function deriveFromEvent(
  ctx: AppContext,
  c: pg.PoolClient,
  e: SignedEvent,
  dutyId: string | null,
  receivedAt: Date,
): Promise<void> {
  const p = e.payload as P;
  const base = {
    officerId: e.officerId,
    deviceId: e.deviceId,
    dutySessionId: dutyId,
    eventId: e.eventId,
  };
  switch (e.eventType) {
    case 'LOCATION_OBSERVED': {
      const loc = p as unknown as LocationLike;
      const s = await insertPatrolLog(c, e, dutyId, receivedAt, loc, null, 'SIGNATURE_VALID');
      await spatialAndMockFlags(ctx, c, e, dutyId, s, loc);
      break;
    }
    case 'EVIDENCE_CAPTURED': {
      const m = p.manifest as EvidenceManifest;
      await c.query(
        `INSERT INTO evidence_objects (evidence_id, event_id, device_id, officer_id, duty_session_id, declared_image_sha256, manifest_sha256,
            manifest, media_type, declared_byte_length) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          p.evidenceId,
          e.eventId,
          e.deviceId,
          e.officerId,
          dutyId,
          p.imageSha256,
          p.manifestSha256,
          JSON.stringify(m),
          m.image.mimeType,
          m.image.byteLength,
        ],
      );
      const loc = m.location.availability === 'AVAILABLE' ? m.location : null;
      const s = await insertPatrolLog(
        c,
        e,
        dutyId,
        receivedAt,
        loc,
        p.evidenceId as string,
        'EVIDENCE_PENDING',
      );
      if (loc) await spatialAndMockFlags(ctx, c, e, dutyId, s, loc);
      if (dutyId && loc) await movementCheck(ctx, c, e, dutyId, m, s);
      const posture = m.devicePosture;
      if (posture.rootIndicators.length || posture.debuggableBuild) {
        await raiseFlag(c, ctx.bus, {
          type: 'DEVICE_INTEGRITY',
          severity: 'MEDIUM',
          title: 'Device integrity indicators present at capture',
          description:
            'Root or debuggable-build indicators were reported. These checks are heuristic and bypassable; absence does not prove integrity.',
          dedupeKey: `integrity:${e.deviceId}:${e.deviceWallTime.slice(0, 10)}`,
          ...base,
          evidenceId: p.evidenceId as string,
          inputs: {
            rootIndicators: posture.rootIndicators,
            debuggableBuild: posture.debuggableBuild,
          },
        });
      }
      break;
    }
    case 'DEVICE_INTEGRITY_OBSERVED': {
      if (
        (p.rootIndicators as string[]).length ||
        p.debuggableBuild === true ||
        (p.emulatorIndicators as string[]).length
      ) {
        await raiseFlag(c, ctx.bus, {
          type: 'DEVICE_INTEGRITY',
          severity: 'MEDIUM',
          title: 'Device integrity indicators reported',
          description:
            'Root, emulator or debuggable-build indicators were reported by the device. Heuristic only.',
          dedupeKey: `integrity:${e.deviceId}:${e.deviceWallTime.slice(0, 10)}`,
          ...base,
          inputs: p,
        });
      }
      break;
    }
    case 'CHECKIN_SCHEDULED':
      await upsertCheckin(c, e, dutyId, {
        scheduled_for: p.scheduledFor,
        deadline_at: p.deadlineAt,
      });
      break;
    case 'CHECKIN_PRESENTED':
      await upsertCheckin(c, e, dutyId, {});
      break;
    case 'BIOMETRIC_SUCCESS':
    case 'BIOMETRIC_FAILURE':
      await upsertCheckin(c, e, dutyId, {
        biometric_result: e.eventType === 'BIOMETRIC_SUCCESS' ? 'SUCCESS' : 'FAILURE',
      });
      break;
    case 'COGNITIVE_CHALLENGE_SUCCESS':
    case 'COGNITIVE_CHALLENGE_FAILURE':
      await upsertCheckin(c, e, dutyId, {
        challenge_result: e.eventType.endsWith('SUCCESS') ? 'SUCCESS' : 'FAILURE',
        challenge_elapsed_ms: p.elapsedMs,
      });
      break;
    case 'CHECKIN_ACKNOWLEDGED':
      await upsertCheckin(c, e, dutyId, {
        scheduled_for: p.scheduledFor,
        deadline_at: p.deadlineAt,
        response_ms: p.responseMs,
      });
      await insertPatrolLog(c, e, dutyId, receivedAt, null, null, 'SIGNATURE_VALID');
      break;
    case 'CHECKIN_ACKNOWLEDGED_LATE':
      await upsertCheckin(c, e, dutyId, {
        scheduled_for: p.scheduledFor,
        deadline_at: p.deadlineAt,
        late_by_ms: p.lateByMs,
      });
      await insertPatrolLog(c, e, dutyId, receivedAt, null, null, 'SIGNATURE_VALID');
      await raiseFlag(c, ctx.bus, {
        type: 'CHECKIN_LATE',
        severity: 'INFO',
        title: 'Check-in acknowledged after the deadline',
        description: `Acknowledged ${Math.round((p.lateByMs as number) / 1000)} s late (device-measured). The original missed record is preserved separately.`,
        dedupeKey: `late:${p.checkinId}`,
        ...base,
        inputs: p,
      });
      break;
    case 'CHECKIN_MISSED':
      await upsertCheckin(c, e, dutyId, {
        scheduled_for: p.scheduledFor,
        deadline_at: p.deadlineAt,
        missed_reason: p.reasonCode,
      });
      await insertPatrolLog(c, e, dutyId, receivedAt, null, null, 'SIGNATURE_VALID');
      await raiseFlag(c, ctx.bus, {
        type: 'CHECKIN_MISSED',
        severity: 'LOW',
        title: 'Check-in not acknowledged within the response window',
        description:
          'A missed check-in is a prompt for review, not evidence of misconduct (the device may have been in a call, out of battery, restricted by the OS, or the officer engaged in duty).',
        dedupeKey: `missed:${p.checkinId}`,
        ...base,
        inputs: p,
      });
      break;
    case 'DUTY_SESSION_STARTED':
      if (dutyId)
        await c.query(
          "UPDATE duty_sessions SET status = CASE WHEN status = 'PLANNED' THEN 'ACTIVE' ELSE status END, device_id = COALESCE(device_id, $2), device_started_at = COALESCE(device_started_at, $3), server_started_received_at = COALESCE(server_started_received_at, $4) WHERE id = $1",
          [dutyId, e.deviceId, e.deviceWallTime, receivedAt],
        );
      if (dutyId) await onDeviceDutyStarted(c, ctx.bus, dutyId);
      await insertPatrolLog(c, e, dutyId, receivedAt, null, null, 'SIGNATURE_VALID');
      break;
    case 'DUTY_SESSION_ENDED':
      if (dutyId)
        await c.query(
          "UPDATE duty_sessions SET status = CASE WHEN status IN ('PLANNED','ACTIVE') THEN 'COMPLETED' ELSE status END, device_ended_at = COALESCE(device_ended_at, $2) WHERE id = $1",
          [dutyId, e.deviceWallTime],
        );
      await insertPatrolLog(c, e, dutyId, receivedAt, null, null, 'SIGNATURE_VALID');
      break;
    case 'CLOCK_ANOMALY_DETECTED': {
      const warnings = (p.anomalies as { severity: string }[]).filter(
        (a) => a.severity === 'WARNING',
      );
      if (warnings.length) {
        await raiseFlag(c, ctx.bus, {
          type: 'CLOCK_ANOMALY',
          severity: 'MEDIUM',
          title: 'Device clock anomaly detected',
          description:
            'The device detected a wall-clock jump, rollback or divergence from monotonic time. Original timestamps are preserved; treat device times in this period with caution.',
          dedupeKey: `clock:${e.eventId}`,
          ...base,
          inputs: p,
        });
      }
      break;
    }
    case 'MOVEMENT_EVIDENCE_INCONSISTENCY':
      await raiseFlag(c, ctx.bus, {
        type: 'MOVEMENT_INCONSISTENCY',
        severity: 'LOW',
        title: 'Device-side movement inconsistency',
        description:
          'The device rules engine reported an inconsistency between location and step evidence. Review the inputs; vehicles, trains and sensor restrictions are common explanations.',
        dedupeKey: `devmove:${e.eventId}`,
        ...base,
        inputs: p,
      });
      break;
    case 'LOCATION_MOCK_INDICATOR':
      if (p.indicator === true) {
        await raiseFlag(c, ctx.bus, {
          type: 'MOCK_LOCATION_INDICATOR',
          severity: 'MEDIUM',
          title: 'Mock-location indicator reported',
          description: 'Client-reported indicator; corroborate before drawing conclusions.',
          dedupeKey: `mock:${dutyId ?? e.deviceId}:${e.deviceWallTime.slice(0, 13)}`,
          ...base,
          inputs: p,
        });
      }
      break;
    default:
      break; // STEP_MILESTONE, MOTION_STATE_CHANGED, TRANSIT_STATE_SUSPECTED, SENSOR_*, SERVICE_LIFECYCLE are stored as original events only.
  }
}

/** Server-side movement correlation between consecutive evidence captures in one duty session. */
async function movementCheck(
  ctx: AppContext,
  c: pg.PoolClient,
  e: SignedEvent,
  dutyId: string,
  m: EvidenceManifest,
  s: SpatialEvaluation,
) {
  const prev = (
    await c.query<{
      event_id: string;
      seq: number;
      envelope: SignedEvent;
      matched_zone_ids: string[];
    }>(
      `SELECT d.event_id, d.device_sequence_number AS seq, d.envelope, pl.matched_zone_ids
       FROM device_events d JOIN patrol_logs pl ON pl.event_id = d.event_id
      WHERE d.duty_session_id = $1 AND d.device_id = $2 AND d.event_type = 'EVIDENCE_CAPTURED' AND pl.location IS NOT NULL
        AND d.device_sequence_number < $3
      ORDER BY d.device_sequence_number DESC LIMIT 1`,
      [dutyId, e.deviceId, e.deviceSequenceNumber],
    )
  ).rows[0];
  if (!prev) return;
  const pm = (prev.envelope.payload as { manifest: EvidenceManifest }).manifest;
  const between = (
    await c.query<{ transit: boolean; interrupted: boolean }>(
      `SELECT bool_or(event_type = 'TRANSIT_STATE_SUSPECTED') AS transit,
            bool_or(event_type IN ('SENSOR_UNAVAILABLE','SENSOR_PERMISSION_REVOKED') AND payload->>'sensor' = 'STEP_COUNTER') AS interrupted
       FROM device_events WHERE device_id = $1 AND device_sequence_number > $2 AND device_sequence_number < $3`,
      [e.deviceId, prev.seq, e.deviceSequenceNumber],
    )
  ).rows[0];
  const dist =
    (
      await c.query<{ d: number }>(
        `SELECT ST_Distance(a.location, b.location) AS d FROM patrol_logs a, patrol_logs b WHERE a.event_id = $1 AND b.event_id = $2`,
        [prev.event_id, e.eventId],
      )
    ).rows[0]?.d ?? null;
  const sameBoot = pm.capture.bootId === m.capture.bootId;
  const t = (mf: EvidenceManifest) =>
    sameBoot ? mf.capture.monotonicElapsedMs : Date.parse(mf.capture.deviceWallTime);
  const assessment = assessMovement(
    {
      eventId: prev.event_id,
      observedAtMs: t(pm),
      bootId: pm.capture.bootId,
      zoneIds: prev.matched_zone_ids,
      latitude: pm.location.latitude,
      longitude: pm.location.longitude,
      horizontalAccuracyM: pm.location.horizontalAccuracyM,
      stepsSinceBoot: pm.motion.stepsSinceBoot,
    },
    {
      eventId: e.eventId,
      observedAtMs: t(m),
      bootId: m.capture.bootId,
      zoneIds: s.matchedZoneIds,
      latitude: m.location.latitude,
      longitude: m.location.longitude,
      horizontalAccuracyM: m.location.horizontalAccuracyM,
      stepsSinceBoot: m.motion.stepsSinceBoot,
    },
    {
      transitSuspectedBetween: between?.transit ?? false,
      stepSensorInterrupted: between?.interrupted ?? false,
      distanceM: dist,
    },
  );
  if (assessment.flagged) {
    await raiseFlag(c, ctx.bus, {
      type: 'MOVEMENT_INCONSISTENCY',
      severity: 'LOW',
      title: 'MOVEMENT_EVIDENCE_INCONSISTENCY between evidence captures',
      description: `${assessment.reasons.join('; ')}. Possible innocent explanations: ${assessment.innocentExplanations.join('; ')}.`,
      dedupeKey: `move:${prev.event_id}:${e.eventId}`,
      officerId: e.officerId,
      deviceId: e.deviceId,
      dutySessionId: dutyId,
      eventId: e.eventId,
      evidenceId: m.evidenceId,
      inputs: assessment as unknown as Record<string, unknown>,
    });
  }
}
