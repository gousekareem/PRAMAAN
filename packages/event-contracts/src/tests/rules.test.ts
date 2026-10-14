import { describe, expect, it } from 'vitest';
import { assessMovement, haversineMeters, TransitDetector } from '../index';

const base = { bootId: 'b1', horizontalAccuracyM: 10 };
const a = {
  ...base,
  eventId: 'a',
  observedAtMs: 0,
  zoneIds: ['Z1'],
  latitude: 16.3008,
  longitude: 80.4428,
  stepsSinceBoot: 1000,
};
const b = {
  ...base,
  eventId: 'b',
  observedAtMs: 2 * 3600_000,
  zoneIds: ['Z2'],
  latitude: 16.32,
  longitude: 80.45,
  stepsSinceBoot: 1020,
};
const quiet = { transitSuspectedBetween: false, stepSensorInterrupted: false };

describe('movement correlation rule', () => {
  it('haversine is accurate to ~1 m for short distances', () => {
    expect(haversineMeters(16.3008, 80.4428, 16.3008, 80.4528)).toBeCloseTo(1067, -1);
  });
  it('flags two captures in different zones 2h apart with < 50 steps', () => {
    const r = assessMovement(a, b, quiet);
    expect(r.flagged).toBe(true);
    expect(r.inputs.stepDelta).toBe(20);
    expect(r.innocentExplanations.length).toBeGreaterThan(0);
  });
  it('does not flag when transit was suspected (train)', () => {
    const r = assessMovement(a, b, { ...quiet, transitSuspectedBetween: true });
    expect(r.flagged).toBe(false);
    expect(r.suppressedBy).toContain('TRANSIT_SUSPECTED');
  });
  it('does not flag across reboot / counter reset / sensor interruption', () => {
    expect(assessMovement(a, { ...b, bootId: 'b2' }, quiet).suppressedBy).toContain(
      'DEVICE_REBOOTED_STEP_COUNTER_RESET',
    );
    expect(assessMovement(a, { ...b, stepsSinceBoot: 5 }, quiet).suppressedBy).toContain(
      'STEP_COUNTER_DECREASED',
    );
    expect(assessMovement(a, b, { ...quiet, stepSensorInterrupted: true }).flagged).toBe(false);
    expect(assessMovement(a, { ...b, stepsSinceBoot: null }, quiet).flagged).toBe(false);
  });
  it('does not flag when enough steps were taken or the distance is within accuracy', () => {
    expect(assessMovement(a, { ...b, stepsSinceBoot: 4000 }, quiet).flagged).toBe(false);
    expect(
      assessMovement(a, { ...b, zoneIds: ['Z1'], latitude: 16.3009, longitude: 80.4428 }, quiet)
        .flagged,
    ).toBe(false);
  });
});

describe('transit detector', () => {
  it('requires two consecutive reliable samples above 60 km/h', () => {
    const d = new TransitDetector();
    const fast = { speedMps: 25, speedAccuracyMps: 1, horizontalAccuracyM: 10, observedAtMs: 0 };
    expect(d.push(fast)).toBeNull();
    expect(d.push(fast)).toBe('ENTERED');
    expect(d.inTransit).toBe(true);
    expect(d.push({ ...fast, speedMps: 1 })).toBe('EXITED');
  });
  it('ignores inaccurate samples', () => {
    const d = new TransitDetector();
    const noisy = { speedMps: 40, speedAccuracyMps: 12, horizontalAccuracyM: 10, observedAtMs: 0 };
    d.push(noisy);
    expect(d.push(noisy)).toBeNull();
    expect(d.push({ ...noisy, speedAccuracyMps: null, horizontalAccuracyM: 300 })).toBeNull();
    expect(d.inTransit).toBe(false);
  });
});
