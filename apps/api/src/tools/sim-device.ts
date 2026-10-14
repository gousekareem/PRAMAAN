import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import jpeg from 'jpeg-js';
import {
  computeEventHash,
  computeManifestHash,
  eventSignatureMessage,
  GENESIS_HASH,
  sha256Hex,
  type EventBody,
  type EventType,
  type EvidenceManifest,
  type SignedEvent,
} from '@pramaan/event-contracts';

/**
 * SIMULATED duty device for tests, demonstrations and benchmarks.
 * It produces exactly the same canonical, hash-linked, ECDSA-P256-signed events as the
 * Android app, but it is NOT a physical device: its "sensor" values are synthetic.
 */
export class SimulatedDevice {
  readonly deviceId: string;
  readonly privateKey: KeyObject;
  readonly publicKeySpki: string;
  seq = 0;
  prevHash = GENESIS_HASH;
  bootId = 'sim-boot-1';
  monotonicMs = 3_600_000;
  stepsSinceBoot = 1000;

  constructor(
    readonly officerId: string,
    deviceId?: string,
  ) {
    this.deviceId = deviceId ?? randomUUID();
    const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = kp.privateKey;
    this.publicKeySpki = kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  }

  registration(label = 'SIMULATOR (synthetic)') {
    return {
      deviceId: this.deviceId,
      label,
      platform: 'SIMULATOR',
      publicKeySpki: this.publicKeySpki,
      keyAlgorithm: 'ECDSA_P256_SHA256',
      keyHardwareBacked: false,
      appVersion: 'sim-1.0.0',
    };
  }

  signHash(hash: string): string {
    return sign(
      'sha256',
      Buffer.from(eventSignatureMessage(hash), 'utf8'),
      this.privateKey,
    ).toString('base64');
  }

  event(
    type: EventType,
    payload: Record<string, unknown>,
    opts: { dutySessionId?: string | null; wallTime?: Date; advanceMs?: number } = {},
  ): SignedEvent {
    this.seq += 1;
    this.monotonicMs += opts.advanceMs ?? 1000;
    const body: EventBody = {
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType: type,
      officerId: this.officerId,
      dutySessionId: opts.dutySessionId ?? null,
      deviceId: this.deviceId,
      deviceSequenceNumber: this.seq,
      deviceWallTime: (opts.wallTime ?? new Date()).toISOString(),
      monotonicElapsedMs: this.monotonicMs,
      bootId: this.bootId,
      trustedTimeEstimate: null,
      trustedTimeUncertaintyMs: null,
      trustedTimeSource: 'DEVICE_WALL_CLOCK_UNANCHORED',
      payload,
      previousEventHash: this.prevHash,
    };
    const eventHash = computeEventHash(body);
    this.prevHash = eventHash;
    return { ...body, eventHash, deviceSignature: this.signHash(eventHash) };
  }

  location(
    lat: number,
    lon: number,
    acc: number,
    opts: {
      dutySessionId?: string | null;
      wallTime?: Date;
      mock?: boolean | null;
      speedMps?: number | null;
    } = {},
  ) {
    const wall = opts.wallTime ?? new Date();
    return this.event(
      'LOCATION_OBSERVED',
      {
        latitude: lat,
        longitude: lon,
        horizontalAccuracyM: acc,
        speedMps: opts.speedMps ?? 0.5,
        speedAccuracyMps: 0.5,
        provider: 'gps',
        fixDeviceTime: wall.toISOString(),
        mockIndicator: opts.mock ?? false,
        mockIndicatorSource: 'SIMULATED',
      },
      { dutySessionId: opts.dutySessionId ?? null, wallTime: wall },
    );
  }

  evidence(opts: {
    dutySessionId: string;
    lat: number | null;
    lon: number | null;
    acc?: number;
    wallTime?: Date;
    steps?: number;
    pattern?: 'scene' | 'grid';
    advanceMs?: number;
  }) {
    const image = syntheticJpeg(opts.pattern ?? 'scene', this.seq + 1);
    const evidenceId = randomUUID();
    const wall = opts.wallTime ?? new Date();
    if (opts.steps !== undefined) this.stepsSinceBoot = opts.steps;
    const has = opts.lat !== null && opts.lon !== null;
    const manifest: EvidenceManifest = {
      manifestVersion: 1,
      evidenceId,
      officerId: this.officerId,
      dutySessionId: opts.dutySessionId,
      deviceId: this.deviceId,
      appVersion: 'sim-1.0.0',
      capture: {
        deviceWallTime: wall.toISOString(),
        monotonicElapsedMs: this.monotonicMs + (opts.advanceMs ?? 1000),
        bootId: this.bootId,
        trustedTimeEstimate: null,
        trustedTimeUncertaintyMs: null,
        cameraId: 'sim-0',
        captureProvenance: 'IN_APP_CAMERA',
        captureApi: 'SIMULATED',
      },
      image: {
        mimeType: 'image/jpeg',
        byteLength: image.length,
        width: 320,
        height: 240,
        sha256: sha256Hex(new Uint8Array(image)),
      },
      location: has
        ? {
            availability: 'AVAILABLE',
            latitude: opts.lat,
            longitude: opts.lon,
            horizontalAccuracyM: opts.acc ?? 8,
            observedAtDeviceTime: wall.toISOString(),
            fixAgeMs: 1500,
            provider: 'gps',
            speedMps: 0.4,
            mockIndicator: false,
            mockIndicatorSource: 'SIMULATED',
          }
        : {
            availability: 'UNAVAILABLE',
            latitude: null,
            longitude: null,
            horizontalAccuracyM: null,
            observedAtDeviceTime: null,
            fixAgeMs: null,
            provider: null,
            speedMps: null,
            mockIndicator: null,
            mockIndicatorSource: null,
          },
      cellular: { availability: 'NOT_SUPPORTED', observations: [] },
      motion: {
        stepCounterAvailability: 'AVAILABLE',
        stepsSinceBoot: this.stepsSinceBoot,
        stepsSinceDutyStart: null,
        motionState: 'STILL',
      },
      devicePosture: {
        debuggableBuild: false,
        rootIndicators: [],
        developerOptionsEnabled: null,
        adbEnabled: null,
        emulatorIndicators: ['SIMULATED_DEVICE'],
        appSigningCertSha256: null,
        keyHardwareBacked: false,
      },
      screenRecaptureRisk: { experimental: true, score: null, method: 'not-run-on-simulator' },
      derivatives: [],
    };
    const event = this.event(
      'EVIDENCE_CAPTURED',
      {
        evidenceId,
        imageSha256: manifest.image.sha256,
        manifestSha256: computeManifestHash(manifest),
        manifest,
      },
      { dutySessionId: opts.dutySessionId, wallTime: wall, advanceMs: opts.advanceMs },
    );
    return { evidenceId, image, manifest, event };
  }

  batch(events: SignedEvent[], batchId: string = randomUUID()) {
    return { batchId, schemaVersion: 1, deviceId: this.deviceId, events };
  }
}

/** Deterministic synthetic JPEG (320x240). 'grid' imitates a periodic display/moiré pattern. */
export function syntheticJpeg(pattern: 'scene' | 'grid', seed: number): Buffer {
  const width = 320;
  const height = 240;
  const data = Buffer.alloc(width * height * 4);
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let v: number;
      if (pattern === 'grid')
        v = 128 + 90 * Math.sin((2 * Math.PI * x) / 3.1) * Math.sin((2 * Math.PI * y) / 3.1);
      else v = 60 + 120 * (y / height) + 30 * Math.sin(x / 40) + 20 * rnd();
      data[i] = Math.max(0, Math.min(255, v + 20));
      data[i + 1] = Math.max(0, Math.min(255, v));
      data[i + 2] = Math.max(0, Math.min(255, v - 20));
      data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 92).data;
}
