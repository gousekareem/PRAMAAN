/**
 * Movement-correlation and transit heuristics.
 *
 * These rules produce REVIEW FLAGS, never conclusions. Every flag carries the inputs that
 * produced it and the list of conditions that could explain it innocently.
 */

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface MovementObservation {
  eventId: string;
  observedAtMs: number;
  bootId: string;
  zoneIds: string[] | null;
  latitude: number | null;
  longitude: number | null;
  horizontalAccuracyM: number | null;
  stepsSinceBoot: number | null;
}

export interface MovementContext {
  /** True if any TRANSIT_STATE_SUSPECTED event lies between the two observations. */
  transitSuspectedBetween: boolean;
  /** True if SENSOR_UNAVAILABLE / SENSOR_PERMISSION_REVOKED for steps occurred between them. */
  stepSensorInterrupted: boolean;
  /** Distance computed by the caller (PostGIS on the server); falls back to haversine. */
  distanceM?: number | null;
}

export interface MovementRuleConfig {
  minElapsedMs: number;
  maxStepDelta: number;
  minSeparationM: number;
}

export const DEFAULT_MOVEMENT_RULE: MovementRuleConfig = {
  minElapsedMs: 30 * 60_000,
  maxStepDelta: 50,
  minSeparationM: 300,
};

export interface MovementAssessment {
  flagged: boolean;
  code: 'MOVEMENT_EVIDENCE_INCONSISTENCY';
  reasons: string[];
  innocentExplanations: string[];
  suppressedBy: string[];
  inputs: {
    fromEventId: string;
    toEventId: string;
    elapsedMs: number;
    distanceM: number | null;
    effectiveSeparationM: number | null;
    stepDelta: number | null;
    differentZones: boolean | null;
  };
}

export function assessMovement(
  a: MovementObservation,
  b: MovementObservation,
  ctx: MovementContext,
  cfg: MovementRuleConfig = DEFAULT_MOVEMENT_RULE,
): MovementAssessment {
  const [first, second] = a.observedAtMs <= b.observedAtMs ? [a, b] : [b, a];
  const elapsedMs = second.observedAtMs - first.observedAtMs;
  const reasons: string[] = [];
  const suppressedBy: string[] = [];

  let distanceM: number | null = ctx.distanceM ?? null;
  if (
    distanceM === null &&
    first.latitude !== null &&
    first.longitude !== null &&
    second.latitude !== null &&
    second.longitude !== null
  ) {
    distanceM = haversineMeters(first.latitude, first.longitude, second.latitude, second.longitude);
  }
  const acc = (first.horizontalAccuracyM ?? 0) + (second.horizontalAccuracyM ?? 0);
  const effectiveSeparationM = distanceM === null ? null : Math.max(0, distanceM - acc);

  let differentZones: boolean | null = null;
  if (first.zoneIds && second.zoneIds && first.zoneIds.length && second.zoneIds.length) {
    differentZones = !first.zoneIds.some((z) => second.zoneIds!.includes(z));
  }

  let stepDelta: number | null = null;
  if (first.stepsSinceBoot !== null && second.stepsSinceBoot !== null) {
    if (first.bootId !== second.bootId) suppressedBy.push('DEVICE_REBOOTED_STEP_COUNTER_RESET');
    else {
      stepDelta = second.stepsSinceBoot - first.stepsSinceBoot;
      if (stepDelta < 0) {
        suppressedBy.push('STEP_COUNTER_DECREASED');
        stepDelta = null;
      }
    }
  } else {
    suppressedBy.push('STEP_DATA_UNAVAILABLE');
  }
  if (ctx.transitSuspectedBetween) suppressedBy.push('TRANSIT_SUSPECTED');
  if (ctx.stepSensorInterrupted) suppressedBy.push('STEP_SENSOR_INTERRUPTED');
  if (first.latitude === null || second.latitude === null)
    suppressedBy.push('LOCATION_UNAVAILABLE');

  const separated =
    differentZones === true ||
    (effectiveSeparationM !== null && effectiveSeparationM >= cfg.minSeparationM);
  if (elapsedMs >= cfg.minElapsedMs) reasons.push(`elapsed ${Math.round(elapsedMs / 60000)} min`);
  if (separated)
    reasons.push(
      differentZones
        ? 'observations in different zones'
        : `separation ≥ ${cfg.minSeparationM} m beyond reported accuracy`,
    );
  if (stepDelta !== null && stepDelta < cfg.maxStepDelta)
    reasons.push(`only ${stepDelta} steps recorded`);

  const candidate =
    elapsedMs >= cfg.minElapsedMs &&
    separated &&
    stepDelta !== null &&
    stepDelta < cfg.maxStepDelta;
  return {
    flagged: candidate && suppressedBy.length === 0,
    code: 'MOVEMENT_EVIDENCE_INCONSISTENCY',
    reasons,
    innocentExplanations: [
      'Officer travelled by vehicle, train, lift or wheelchair',
      'Phone carried in a bag or vehicle mount where steps are not detected',
      'OEM battery management suspended the step sensor',
      'GPS error larger than reported accuracy',
    ],
    suppressedBy,
    inputs: {
      fromEventId: first.eventId,
      toEventId: second.eventId,
      elapsedMs,
      distanceM,
      effectiveSeparationM,
      stepDelta,
      differentZones,
    },
  };
}

export interface SpeedSample {
  speedMps: number | null;
  speedAccuracyMps: number | null;
  horizontalAccuracyM: number | null;
  observedAtMs: number;
}

export const TRANSIT_SPEED_MPS = 60 / 3.6; // ~60 km/h

/**
 * Suspects transit when two consecutive reliable samples exceed ~60 km/h.
 * A speed observation is NOT a confirmed train journey.
 */
export class TransitDetector {
  private consecutive = 0;
  private suspected = false;
  constructor(
    private readonly minConsecutive = 2,
    private readonly maxHorizontalAccuracyM = 50,
    private readonly maxSpeedAccuracyMps = 5,
  ) {}

  isReliable(s: SpeedSample): boolean {
    if (s.speedMps === null || s.horizontalAccuracyM === null) return false;
    if (s.horizontalAccuracyM > this.maxHorizontalAccuracyM) return false;
    if (s.speedAccuracyMps !== null && s.speedAccuracyMps > this.maxSpeedAccuracyMps) return false;
    return true;
  }

  /** Returns 'ENTERED' / 'EXITED' on state transitions, otherwise null. */
  push(s: SpeedSample): 'ENTERED' | 'EXITED' | null {
    if (!this.isReliable(s)) return null;
    if (s.speedMps! >= TRANSIT_SPEED_MPS) {
      this.consecutive++;
      if (!this.suspected && this.consecutive >= this.minConsecutive) {
        this.suspected = true;
        return 'ENTERED';
      }
    } else {
      this.consecutive = 0;
      if (this.suspected && s.speedMps! < TRANSIT_SPEED_MPS / 3) {
        this.suspected = false;
        return 'EXITED';
      }
    }
    return null;
  }

  get inTransit(): boolean {
    return this.suspected;
  }
}
