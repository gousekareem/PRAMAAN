import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import {
  computeAuditHash,
  computeEventHash,
  computeManifestHash,
  eventSignatureMessage,
  GENESIS_HASH,
  sha256Hex,
  type EventBody,
  type EvidenceManifest,
  type SignedEvent,
} from '@pramaan/event-contracts';
import { buildEvidencePackage, verifyPackageZip } from '../index';

const DEVICE = '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01';
const OFFICER = '1a2b3c4d-1111-4aaa-8bbb-000000000001';
const DUTY = '9e8d7c6b-2222-4ccc-9ddd-000000000002';
const EVIDENCE = '3f0c1d2e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const image = new Uint8Array(4096);
  image.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < image.length; i++) image[i] = (i * 31) & 0xff;
  const manifest: EvidenceManifest = {
    manifestVersion: 1,
    evidenceId: EVIDENCE,
    officerId: OFFICER,
    dutySessionId: DUTY,
    deviceId: DEVICE,
    appVersion: '1.0.0',
    capture: {
      deviceWallTime: '2026-10-01T08:00:00.000Z',
      monotonicElapsedMs: 1000,
      bootId: 'b1',
      trustedTimeEstimate: null,
      trustedTimeUncertaintyMs: null,
      cameraId: '0',
      captureProvenance: 'IN_APP_CAMERA',
      captureApi: 'test',
    },
    image: {
      mimeType: 'image/jpeg',
      byteLength: image.length,
      width: 640,
      height: 480,
      sha256: sha256Hex(image),
    },
    location: {
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
      stepCounterAvailability: 'UNAVAILABLE',
      stepsSinceBoot: null,
      stepsSinceDutyStart: null,
      motionState: null,
    },
    devicePosture: {
      debuggableBuild: false,
      rootIndicators: [],
      developerOptionsEnabled: null,
      adbEnabled: null,
      emulatorIndicators: [],
      appSigningCertSha256: null,
      keyHardwareBacked: null,
    },
    screenRecaptureRisk: { experimental: true, score: null, method: 'none' },
    derivatives: [],
  };
  const bodies: Omit<EventBody, 'previousEventHash' | 'deviceSequenceNumber'>[] = [
    { eventType: 'DUTY_SESSION_STARTED', payload: { assignedZoneIds: [], startedVia: 'APP' } },
    {
      eventType: 'EVIDENCE_CAPTURED',
      payload: {
        evidenceId: EVIDENCE,
        imageSha256: manifest.image.sha256,
        manifestSha256: computeManifestHash(manifest),
        manifest,
      },
    },
  ].map((b, i) => ({
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    officerId: OFFICER,
    dutySessionId: DUTY,
    deviceId: DEVICE,
    deviceWallTime: `2026-10-01T08:00:0${i}.000Z`,
    monotonicElapsedMs: 1000 + i,
    bootId: 'b1',
    trustedTimeEstimate: null,
    trustedTimeUncertaintyMs: null,
    trustedTimeSource: 'DEVICE_WALL_CLOCK_UNANCHORED',
    ...b,
  })) as never;
  let prev = GENESIS_HASH;
  const events: SignedEvent[] = bodies.map((b, i) => {
    const body = { ...b, deviceSequenceNumber: i + 1, previousEventHash: prev } as EventBody;
    const eventHash = computeEventHash(body);
    prev = eventHash;
    const deviceSignature = sign(
      'sha256',
      Buffer.from(eventSignatureMessage(eventHash)),
      privateKey,
    ).toString('base64');
    return { ...body, eventHash, deviceSignature };
  });
  const custodyBody = {
    auditId: '11111111-1111-4111-8111-111111111111',
    sequence: 7,
    occurredAt: '2026-10-01T09:00:00.000Z',
    actorUserId: null,
    actorRole: 'DEVICE',
    action: 'EVIDENCE_VERIFIED',
    targetType: 'evidence',
    targetId: EVIDENCE,
    evidenceId: EVIDENCE,
    requestId: 'r1',
    details: {},
    previousHash: 'b'.repeat(64),
  };
  const custody = [{ ...custodyBody, recordHash: computeAuditHash(custodyBody) }];
  return { image, manifest, events, spki, custody };
}

function pkg(f = fixture()) {
  return buildEvidencePackage({
    evidenceId: EVIDENCE,
    generatedBy: 'test',
    image: f.image,
    manifest: f.manifest,
    events: f.events,
    publicKey: {
      deviceId: DEVICE,
      publicKeySpkiBase64: f.spki,
      algorithm: 'ECDSA_P256_SHA256',
      keyStatus: 'ACTIVE',
      revokedAt: null,
    },
    serverVerification: { status: 'VERIFIED' },
    custody: f.custody,
  }).zip;
}

function tamper(zip: Uint8Array, path: string, mutate: (b: Uint8Array) => Uint8Array): Uint8Array {
  const files = unzipSync(zip);
  files[path] = mutate(files[path]!);
  return zipSync(files);
}

describe('independent evidence package verifier', () => {
  it('PASSes an untouched package', () => {
    const r = verifyPackageZip(pkg());
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([]);
    expect(r.status).toBe('PASS');
  });
  it('FAILs when a single byte of the image is modified', () => {
    const z = tamper(pkg(), 'evidence/original.jpg', (b) => {
      const c = b.slice();
      c[100] ^= 1;
      return c;
    });
    const r = verifyPackageZip(z);
    expect(r.status).toBe('FAIL');
    expect(r.checks.find((c) => c.id === 'image.sha256')?.status).toBe('FAIL');
  });
  it('FAILs when the image is replaced AND the index is rewritten (manifest binding)', () => {
    const f = fixture();
    const other = f.image.slice();
    other[200] ^= 0xff;
    const z = buildEvidencePackage({
      evidenceId: EVIDENCE,
      generatedBy: 'attacker',
      image: other,
      manifest: f.manifest,
      events: f.events,
      publicKey: {
        deviceId: DEVICE,
        publicKeySpkiBase64: f.spki,
        algorithm: 'ECDSA_P256_SHA256',
        keyStatus: 'ACTIVE',
        revokedAt: null,
      },
      serverVerification: {},
      custody: f.custody,
    }).zip;
    expect(verifyPackageZip(z).status).toBe('FAIL');
  });
  it('FAILs when manifest metadata is edited and rehashed (signature + event binding)', () => {
    const f = fixture();
    f.manifest.capture.deviceWallTime = '2026-10-01T06:00:00.000Z';
    const r = verifyPackageZip(pkg(f));
    expect(r.status).toBe('FAIL');
    expect(r.checks.find((c) => c.id === 'ledger.manifestHash')?.status).toBe('FAIL');
  });
  it('FAILs when an event is re-hashed with a forged signature key', () => {
    const f = fixture();
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    f.events[0]!.deviceSignature = sign(
      'sha256',
      Buffer.from(eventSignatureMessage(f.events[0]!.eventHash)),
      privateKey,
    ).toString('base64');
    expect(verifyPackageZip(pkg(f)).checks.find((c) => c.id === 'ledger.signatures')?.status).toBe(
      'FAIL',
    );
  });
  it('detects modified custody records and broken audit links', () => {
    const f = fixture();
    f.custody[0]!.action = 'EVIDENCE_DELETED';
    expect(verifyPackageZip(pkg(f)).checks.find((c) => c.id === 'custody.records')?.status).toBe(
      'FAIL',
    );
  });
  it('reports INCOMPLETE when required files are missing and FAIL for unlisted files', () => {
    const files = unzipSync(pkg());
    delete files['ledger/events.json'];
    expect(verifyPackageZip(zipSync(files)).status).toBe('INCOMPLETE');
    const extra = unzipSync(pkg());
    extra['evidence/replacement.jpg'] = new Uint8Array([1, 2, 3]);
    expect(verifyPackageZip(zipSync(extra)).status).toBe('FAIL');
  });
  it('FAILs a non-ZIP input', () => {
    expect(verifyPackageZip(new Uint8Array([1, 2, 3])).status).toBe('FAIL');
  });
});
