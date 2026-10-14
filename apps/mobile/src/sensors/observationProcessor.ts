import { TransitDetector } from '@pramaan/event-contracts';
import type { LedgerService } from '../ledger/ledger';

/** Observation records buffered by the native foreground service (AES-GCM encrypted at rest). */
export type NativeObservation =
  | {
      kind: 'LOCATION';
      latitude: number;
      longitude: number;
      accuracyM: number | null;
      speedMps: number | null;
      speedAccuracyMps: number | null;
      provider: string;
      fixWallTime: string;
      isMock: boolean | null;
      mockSource: string | null;
    }
  | { kind: 'STEPS'; stepsSinceBoot: number }
  | { kind: 'MOTION'; from: string; to: string; confidence: number }
  | {
      kind: 'SENSOR_UNAVAILABLE';
      sensor: 'STEP_COUNTER' | 'ACCELEROMETER' | 'LOCATION';
      reason: string;
    }
  | {
      kind: 'PERMISSION_REVOKED';
      sensor: 'LOCATION' | 'STEP_COUNTER' | 'NOTIFICATIONS';
      permission: string;
    }
  | {
      kind: 'SERVICE';
      state:
        | 'STARTED'
        | 'STOPPED'
        | 'RESTARTED'
        | 'UNEXPECTED_TERMINATION_DETECTED'
        | 'BOOT_RECOVERY';
      detail: string;
    };

export interface ProcessorConfig {
  /** Minimum spacing between persisted LOCATION_OBSERVED events (data minimisation). */
  minLocationIntervalMs: number;
  /** Persist a location early if it moved more than this distance. */
  minLocationDistanceM: number;
  stepMilestone: number;
}

export const DEFAULT_PROCESSOR: ProcessorConfig = {
  minLocationIntervalMs: 5 * 60_000,
  minLocationDistanceM: 150,
  stepMilestone: 250,
};

function dist(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const R = 6_371_000;
  const r = (d: number) => (d * Math.PI) / 180;
  const x = r(b.longitude - a.longitude) * Math.cos(r((a.latitude + b.latitude) / 2));
  const y = r(b.latitude - a.latitude);
  return Math.sqrt(x * x + y * y) * R;
}

/**
 * Converts raw native observations into minimised ledger events: sub-sampled locations,
 * step milestones, transit suspicion (speed > ~60 km/h on reliable fixes) and sensor/permission changes.
 */
export class ObservationProcessor {
  private lastLoc: { latitude: number; longitude: number; at: number } | null = null;
  private lastStepMilestone: number | null = null;
  private readonly transit = new TransitDetector();
  constructor(
    private readonly ledger: LedgerService,
    private readonly cfg: ProcessorConfig = DEFAULT_PROCESSOR,
  ) {}

  async process(dutySessionId: string, obs: NativeObservation[]): Promise<number> {
    let appended = 0;
    const opt = { dutySessionId };
    for (const o of obs) {
      switch (o.kind) {
        case 'LOCATION': {
          const at = Date.parse(o.fixWallTime);
          const t = this.transit.push({
            speedMps: o.speedMps,
            speedAccuracyMps: o.speedAccuracyMps,
            horizontalAccuracyM: o.accuracyM,
            observedAtMs: at,
          });
          if (t) {
            await this.ledger.append(
              'TRANSIT_STATE_SUSPECTED',
              {
                state: t,
                speedMps: o.speedMps ?? 0,
                speedAccuracyMps: o.speedAccuracyMps,
                horizontalAccuracyM: o.accuracyM,
              },
              opt,
            );
            appended++;
          }
          const due =
            !this.lastLoc ||
            at - this.lastLoc.at >= this.cfg.minLocationIntervalMs ||
            dist(this.lastLoc, o) >= this.cfg.minLocationDistanceM;
          if (due || o.isMock === true) {
            await this.ledger.append(
              'LOCATION_OBSERVED',
              {
                latitude: o.latitude,
                longitude: o.longitude,
                horizontalAccuracyM: o.accuracyM,
                speedMps: o.speedMps,
                speedAccuracyMps: o.speedAccuracyMps,
                provider: o.provider,
                fixDeviceTime: o.fixWallTime,
                mockIndicator: o.isMock,
                mockIndicatorSource: o.mockSource,
              },
              opt,
            );
            this.lastLoc = { latitude: o.latitude, longitude: o.longitude, at };
            appended++;
          }
          if (o.isMock === true) {
            await this.ledger.append(
              'LOCATION_MOCK_INDICATOR',
              {
                indicator: true,
                source: o.mockSource ?? 'unknown',
                latitude: o.latitude,
                longitude: o.longitude,
              },
              opt,
            );
            appended++;
          }
          break;
        }
        case 'STEPS': {
          if (
            this.lastStepMilestone === null ||
            o.stepsSinceBoot < this.lastStepMilestone ||
            o.stepsSinceBoot - this.lastStepMilestone >= this.cfg.stepMilestone
          ) {
            await this.ledger.append(
              'STEP_MILESTONE',
              { stepsSinceBoot: o.stepsSinceBoot, stepsSinceDutyStart: null },
              opt,
            );
            this.lastStepMilestone = o.stepsSinceBoot;
            appended++;
          }
          break;
        }
        case 'MOTION':
          await this.ledger.append(
            'MOTION_STATE_CHANGED',
            { from: o.from, to: o.to, confidence: o.confidence },
            opt,
          );
          appended++;
          break;
        case 'SENSOR_UNAVAILABLE':
          await this.ledger.append(
            'SENSOR_UNAVAILABLE',
            { sensor: o.sensor, reason: o.reason },
            opt,
          );
          appended++;
          break;
        case 'PERMISSION_REVOKED':
          await this.ledger.append(
            'SENSOR_PERMISSION_REVOKED',
            { sensor: o.sensor, permission: o.permission },
            opt,
          );
          appended++;
          break;
        case 'SERVICE':
          await this.ledger.append(
            'SERVICE_LIFECYCLE',
            { state: o.state, detail: o.detail.slice(0, 200) },
            opt,
          );
          appended++;
          break;
      }
    }
    return appended;
  }
}
