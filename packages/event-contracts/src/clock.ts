import type { TrustedTimeSource } from './event';

/**
 * Trusted-time model.
 *
 * An offline phone cannot know authoritative time. PRAMAAN therefore records:
 *   - device wall-clock time (user-adjustable, NOT trusted),
 *   - monotonic elapsed time since boot (cannot be set by the user, resets on reboot),
 *   - the last server-provided time anchor (server time + monotonic value at that moment).
 * The trusted-time estimate is anchor.serverTime + (monotonicNow - anchor.monotonic),
 * valid only within the same boot. Its uncertainty grows with elapsed time.
 */
export interface TimeAnchor {
  serverTime: string;
  monotonicMs: number;
  bootId: string;
  deviceWallTimeAtAnchor: string;
  roundTripMs: number;
}

export interface TrustedTimeEstimate {
  estimate: string | null;
  uncertaintyMs: number | null;
  source: TrustedTimeSource;
}

/** Conservative crystal-oscillator drift allowance (parts per million). */
export const MONOTONIC_DRIFT_PPM = 100;
export const BASE_UNCERTAINTY_MS = 50;

export function estimateTrustedTime(
  anchor: TimeAnchor | null,
  nowMonotonicMs: number,
  bootId: string,
): TrustedTimeEstimate {
  if (!anchor || anchor.bootId !== bootId || nowMonotonicMs < anchor.monotonicMs) {
    return { estimate: null, uncertaintyMs: null, source: 'DEVICE_WALL_CLOCK_UNANCHORED' };
  }
  const elapsed = nowMonotonicMs - anchor.monotonicMs;
  const est = Date.parse(anchor.serverTime) + elapsed;
  const uncertainty = Math.ceil(
    BASE_UNCERTAINTY_MS + anchor.roundTripMs / 2 + (elapsed * MONOTONIC_DRIFT_PPM) / 1_000_000,
  );
  return {
    estimate: new Date(est).toISOString(),
    uncertaintyMs: uncertainty,
    source: 'SERVER_ANCHOR_MONOTONIC',
  };
}

export interface ClockSample {
  deviceWallTime: string;
  monotonicElapsedMs: number;
  bootId: string;
}

export type ClockAnomalyCode =
  | 'WALL_CLOCK_ROLLBACK'
  | 'WALL_MONOTONIC_DIVERGENCE'
  | 'DEVICE_REBOOTED'
  | 'DEVICE_CLOCK_SKEW'
  | 'FUTURE_TIMESTAMP'
  | 'MONOTONIC_REGRESSION';

export interface ClockAnomaly {
  code: ClockAnomalyCode;
  severity: 'INFO' | 'WARNING';
  detail: string;
  deltaMs: number | null;
}

export const ROLLBACK_TOLERANCE_MS = 2_000;
export const DIVERGENCE_TOLERANCE_MS = 60_000;
export const SKEW_TOLERANCE_MS = 5 * 60_000;

/** Compares two consecutive local clock samples. Original observations are never modified. */
export function detectClockAnomalies(
  prev: ClockSample | null,
  cur: ClockSample,
  trusted: TrustedTimeEstimate | null = null,
): ClockAnomaly[] {
  const out: ClockAnomaly[] = [];
  const curWall = Date.parse(cur.deviceWallTime);
  if (prev) {
    const prevWall = Date.parse(prev.deviceWallTime);
    const dWall = curWall - prevWall;
    if (prev.bootId !== cur.bootId) {
      out.push({
        code: 'DEVICE_REBOOTED',
        severity: 'INFO',
        detail: 'Boot identifier changed; monotonic comparison not possible',
        deltaMs: null,
      });
      if (dWall < -ROLLBACK_TOLERANCE_MS) {
        out.push({
          code: 'WALL_CLOCK_ROLLBACK',
          severity: 'WARNING',
          detail: 'Wall clock earlier than previous event across a reboot',
          deltaMs: dWall,
        });
      }
    } else {
      const dMono = cur.monotonicElapsedMs - prev.monotonicElapsedMs;
      if (dMono < 0) {
        out.push({
          code: 'MONOTONIC_REGRESSION',
          severity: 'WARNING',
          detail: 'Monotonic clock decreased within one boot',
          deltaMs: dMono,
        });
      }
      if (dWall < -ROLLBACK_TOLERANCE_MS) {
        out.push({
          code: 'WALL_CLOCK_ROLLBACK',
          severity: 'WARNING',
          detail: 'Wall clock moved backwards',
          deltaMs: dWall,
        });
      }
      const divergence = dWall - dMono;
      if (Math.abs(divergence) > DIVERGENCE_TOLERANCE_MS) {
        out.push({
          code: 'WALL_MONOTONIC_DIVERGENCE',
          severity: 'WARNING',
          detail: 'Wall-clock change differs from elapsed monotonic time',
          deltaMs: divergence,
        });
      }
    }
  }
  if (trusted?.estimate) {
    const skew = curWall - Date.parse(trusted.estimate);
    if (Math.abs(skew) > SKEW_TOLERANCE_MS + (trusted.uncertaintyMs ?? 0)) {
      out.push({
        code: 'DEVICE_CLOCK_SKEW',
        severity: 'WARNING',
        detail: 'Device wall clock differs from anchored trusted-time estimate',
        deltaMs: skew,
      });
    }
  }
  return out;
}

/** Server-side plausibility check against server receipt time. */
export function serverTimestampPlausibility(
  deviceWallTime: string,
  serverReceivedAt: Date,
  maxFutureSkewMs = SKEW_TOLERANCE_MS,
): ClockAnomaly[] {
  const d = Date.parse(deviceWallTime) - serverReceivedAt.getTime();
  if (d > maxFutureSkewMs) {
    return [
      {
        code: 'FUTURE_TIMESTAMP',
        severity: 'WARNING',
        detail: 'Device time is later than server receipt time',
        deltaMs: d,
      },
    ];
  }
  return [];
}
