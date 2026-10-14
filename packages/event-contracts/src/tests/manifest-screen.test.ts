import { describe, expect, it } from 'vitest';
import {
  computeManifestHash,
  estimateScreenRecaptureRisk,
  validateManifest,
  type EvidenceManifest,
} from '../index';

export function sampleManifest(): EvidenceManifest {
  return {
    manifestVersion: 1,
    evidenceId: '3f0c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    officerId: '1a2b3c4d-1111-4aaa-8bbb-000000000001',
    dutySessionId: '9e8d7c6b-2222-4ccc-9ddd-000000000002',
    deviceId: '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01',
    appVersion: '1.0.0',
    capture: {
      deviceWallTime: '2026-10-01T08:00:00.000Z',
      monotonicElapsedMs: 1000,
      bootId: 'b',
      trustedTimeEstimate: null,
      trustedTimeUncertaintyMs: null,
      cameraId: '0',
      captureProvenance: 'IN_APP_CAMERA',
      captureApi: 'CameraX/VisionCamera',
    },
    image: {
      mimeType: 'image/jpeg',
      byteLength: 2048,
      width: 640,
      height: 480,
      sha256: 'a'.repeat(64),
    },
    location: {
      availability: 'AVAILABLE',
      latitude: 16.3,
      longitude: 80.44,
      horizontalAccuracyM: 9,
      observedAtDeviceTime: '2026-10-01T07:59:58.000Z',
      fixAgeMs: 2000,
      provider: 'gps',
      speedMps: 0,
      mockIndicator: false,
      mockIndicatorSource: 'Location.isMock',
    },
    cellular: { availability: 'PERMISSION_DENIED', observations: [] },
    motion: {
      stepCounterAvailability: 'AVAILABLE',
      stepsSinceBoot: 1234,
      stepsSinceDutyStart: 400,
      motionState: 'STILL',
    },
    devicePosture: {
      debuggableBuild: false,
      rootIndicators: [],
      developerOptionsEnabled: false,
      adbEnabled: false,
      emulatorIndicators: [],
      appSigningCertSha256: null,
      keyHardwareBacked: true,
    },
    screenRecaptureRisk: { experimental: true, score: 0.1, method: 'x' },
    derivatives: [],
  };
}

describe('evidence manifest', () => {
  it('accepts a well-formed manifest and produces a stable hash', () => {
    const m = sampleManifest();
    expect(validateManifest(m)).toEqual([]);
    const reordered = JSON.parse(JSON.stringify(m)) as EvidenceManifest;
    expect(computeManifestHash(reordered)).toBe(computeManifestHash(m));
  });
  it('rejects fabricated location data marked unavailable and gallery provenance', () => {
    const m = sampleManifest();
    m.location.availability = 'UNAVAILABLE';
    (m.capture as { captureProvenance: string }).captureProvenance = 'GALLERY_IMPORT';
    m.cellular.observations.push({
      radio: 'LTE',
      registered: true,
      mcc: '404',
      mnc: '49',
      areaCode: 1,
      cellId: 2,
      signalDbm: -90,
    });
    const fields = validateManifest(m).map((i) => i.field);
    expect(fields).toEqual(
      expect.arrayContaining(['location', 'capture.captureProvenance', 'cellular']),
    );
  });
  it('rejects out-of-range coordinates and oversize images', () => {
    const m = sampleManifest();
    m.location.latitude = 123;
    m.image.byteLength = 50 * 1024 * 1024;
    expect(validateManifest(m).map((i) => i.field)).toEqual(
      expect.arrayContaining(['location.latitude', 'image.byteLength']),
    );
  });
});

function synth(w: number, h: number, f: (x: number, y: number) => number) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return { width: w, height: h, data };
}

// Deterministic PRNG for reproducible synthetic images.
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('EXPERIMENTAL screen-recapture risk (synthetic patterns only)', () => {
  it('scores a moiré-like periodic grid high', () => {
    const r = rng(1);
    const img = synth(
      512,
      512,
      (x, y) =>
        128 + 60 * Math.sin((2 * Math.PI * x) / 6.3) * Math.sin((2 * Math.PI * y) / 6.3) + 10 * r(),
    );
    const res = estimateScreenRecaptureRisk(img);
    expect(res.experimental).toBe(true);
    expect(res.score).toBeGreaterThan(0.7);
  });
  it('scores natural-like noise and smooth gradients low', () => {
    const r = rng(2);
    // 1/f-like texture: blurred noise
    const noise = synth(512, 512, () => 128 + 50 * (r() - 0.5));
    expect(estimateScreenRecaptureRisk(noise).score).toBeLessThan(0.3);
    const grad = synth(512, 512, (x, y) => (x + y) / 4 + 5 * r());
    expect(estimateScreenRecaptureRisk(grad).score).toBeLessThan(0.3);
  });
  it('KNOWN FALSE POSITIVE: a real-world periodic texture (tiles/grille) also scores high', () => {
    const tiles = synth(512, 512, (x, y) =>
      (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 200 : 60,
    );
    expect(estimateScreenRecaptureRisk(tiles).score).toBeGreaterThan(0.5);
  });
});
