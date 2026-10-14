import { describe, expect, it } from 'vitest';
import { detectClockAnomalies, estimateTrustedTime, serverTimestampPlausibility } from '../index';

const anchor = {
  serverTime: '2026-10-01T08:00:00.000Z',
  monotonicMs: 5_000_000,
  bootId: 'b1',
  deviceWallTimeAtAnchor: '2026-10-01T08:00:01.000Z',
  roundTripMs: 400,
};

describe('trusted time model', () => {
  it('estimates time from the anchor and monotonic clock with growing uncertainty', () => {
    const eightHours = 8 * 3600_000;
    const t = estimateTrustedTime(anchor, anchor.monotonicMs + eightHours, 'b1');
    expect(t.source).toBe('SERVER_ANCHOR_MONOTONIC');
    expect(t.estimate).toBe('2026-10-01T16:00:00.000Z');
    // 50 base + 200 (rtt/2) + 2880 (100 ppm of 8h)
    expect(t.uncertaintyMs).toBe(3130);
  });
  it('is unanchored after a reboot or without an anchor (never invents NTP time)', () => {
    expect(estimateTrustedTime(anchor, 10, 'b2')).toEqual({
      estimate: null,
      uncertaintyMs: null,
      source: 'DEVICE_WALL_CLOCK_UNANCHORED',
    });
    expect(estimateTrustedTime(null, 10, 'b1').estimate).toBeNull();
  });
  it('detects wall-clock rollback while monotonic time advances', () => {
    const a = detectClockAnomalies(
      { deviceWallTime: '2026-10-01T10:00:00.000Z', monotonicElapsedMs: 1000, bootId: 'b1' },
      { deviceWallTime: '2026-10-01T09:00:00.000Z', monotonicElapsedMs: 61_000, bootId: 'b1' },
    );
    expect(a.map((x) => x.code)).toEqual(['WALL_CLOCK_ROLLBACK', 'WALL_MONOTONIC_DIVERGENCE']);
  });
  it('detects forward clock jumps', () => {
    const a = detectClockAnomalies(
      { deviceWallTime: '2026-10-01T10:00:00.000Z', monotonicElapsedMs: 1000, bootId: 'b1' },
      { deviceWallTime: '2026-10-01T13:00:00.000Z', monotonicElapsedMs: 61_000, bootId: 'b1' },
    );
    expect(a.map((x) => x.code)).toEqual(['WALL_MONOTONIC_DIVERGENCE']);
  });
  it('accepts normal progression', () => {
    expect(
      detectClockAnomalies(
        { deviceWallTime: '2026-10-01T10:00:00.000Z', monotonicElapsedMs: 1000, bootId: 'b1' },
        { deviceWallTime: '2026-10-01T10:01:00.050Z', monotonicElapsedMs: 61_000, bootId: 'b1' },
      ),
    ).toEqual([]);
  });
  it('flags a reboot as informational', () => {
    const a = detectClockAnomalies(
      { deviceWallTime: '2026-10-01T10:00:00.000Z', monotonicElapsedMs: 900_000, bootId: 'b1' },
      { deviceWallTime: '2026-10-01T10:05:00.000Z', monotonicElapsedMs: 30_000, bootId: 'b2' },
    );
    expect(a).toEqual([expect.objectContaining({ code: 'DEVICE_REBOOTED', severity: 'INFO' })]);
  });
  it('flags skew against anchored trusted time', () => {
    const t = estimateTrustedTime(anchor, anchor.monotonicMs + 60_000, 'b1');
    const a = detectClockAnomalies(
      null,
      {
        deviceWallTime: '2026-10-01T09:01:00.000Z',
        monotonicElapsedMs: anchor.monotonicMs + 60_000,
        bootId: 'b1',
      },
      t,
    );
    expect(a[0]?.code).toBe('DEVICE_CLOCK_SKEW');
  });
  it('server flags future device timestamps', () => {
    expect(
      serverTimestampPlausibility('2026-10-01T12:00:00Z', new Date('2026-10-01T11:00:00Z'))[0]
        ?.code,
    ).toBe('FUTURE_TIMESTAMP');
    expect(
      serverTimestampPlausibility('2026-10-01T03:00:00Z', new Date('2026-10-01T11:00:00Z')),
    ).toEqual([]);
  });
});
