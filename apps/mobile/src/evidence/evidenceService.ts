import {
  computeManifestHash,
  estimateScreenRecaptureRisk,
  estimateTrustedTime,
  MAX_EVIDENCE_BYTES,
  SCREEN_RISK_METHOD,
  validateManifest,
  type EvidenceManifest,
  type ManifestCellObservation,
  type ManifestLocation,
} from '@pramaan/event-contracts';
import type { LedgerService } from '../ledger/ledger';
import type { SqlDatabase } from '../storage/db';
import { uuidV4, type DeviceClock, type RandomSource } from '../types/platform';

export interface CaptureResult {
  tempPath: string;
  width: number;
  height: number;
  cameraId: string | null;
  captureApi: string;
}

export interface SealResult {
  sealedPath: string;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  mimeType: string;
}

/** Native evidence pipeline (Kotlin): in-app CameraX capture only — there is no gallery/import path. */
export interface EvidenceNative {
  capture(): Promise<CaptureResult>;
  /** Streams the temp file through SHA-256 and AES-GCM (Keystore key), deletes the plaintext temp. */
  seal(tempPath: string): Promise<SealResult>;
  lumaThumbnail(
    sealedPath: string,
    size: number,
  ): Promise<{ width: number; height: number; base64: string }>;
  discardSealed(sealedPath: string): Promise<void>;
}

export interface CaptureContext {
  location(): Promise<ManifestLocation>;
  cellular(): Promise<{
    availability: EvidenceManifest['cellular']['availability'];
    observations: ManifestCellObservation[];
  }>;
  motion(): Promise<EvidenceManifest['motion']>;
  posture(): Promise<EvidenceManifest['devicePosture']>;
  appVersion: string;
}

export class EvidenceError extends Error {}

function b64ToBytes(b64: string): Uint8Array {
  const bin = (globalThis as { atob?: (s: string) => string }).atob?.(b64);
  if (bin === undefined) throw new Error('atob unavailable');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Evidence capture flow (docs/architecture.md §Evidence):
 *  capture (native camera) → validate → seal (SHA-256 + AES-GCM at rest) → canonical manifest →
 *  manifest SHA-256 → EVIDENCE_CAPTURED event (hash-linked, device-signed) + manifest row in ONE
 *  transaction → queued for sync. A failure before the transaction discards the sealed file.
 */
export class EvidenceService {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ledger: LedgerService,
    private readonly native: EvidenceNative,
    private readonly ctx: CaptureContext,
    private readonly clock: DeviceClock,
    private readonly random: RandomSource,
  ) {}

  async captureEvidence(ids: { dutySessionId: string; officerId: string; deviceId: string }) {
    const shot = await this.native.capture();
    const clock = await this.clock.now();
    const anchor = await this.ledger.latestAnchor();
    const sealed = await this.native.seal(shot.tempPath);
    try {
      if (sealed.mimeType !== 'image/jpeg')
        throw new EvidenceError('Only JPEG captures are accepted');
      if (sealed.byteLength <= 0 || sealed.byteLength > MAX_EVIDENCE_BYTES)
        throw new EvidenceError(`Image size ${sealed.byteLength} outside limits`);
      if (sealed.width < 64 || sealed.height < 64)
        throw new EvidenceError('Image dimensions too small');
      let screen: EvidenceManifest['screenRecaptureRisk'] = {
        experimental: true,
        score: null,
        method: 'unavailable',
      };
      try {
        const t = await this.native.lumaThumbnail(sealed.sealedPath, 256);
        const r = estimateScreenRecaptureRisk({
          width: t.width,
          height: t.height,
          data: b64ToBytes(t.base64),
        });
        screen = { experimental: true, score: r.score, method: SCREEN_RISK_METHOD };
      } catch {
        /* analysis is optional and never blocks evidence */
      }
      const [location, cellular, motion, posture] = await Promise.all([
        this.ctx.location(),
        this.ctx.cellular(),
        this.ctx.motion(),
        this.ctx.posture(),
      ]);
      const trusted = estimateTrustedTime(anchor, clock.monotonicMs, clock.bootId);
      const evidenceId = uuidV4(this.random);
      const manifest: EvidenceManifest = {
        manifestVersion: 1,
        evidenceId,
        officerId: ids.officerId,
        dutySessionId: ids.dutySessionId,
        deviceId: ids.deviceId,
        appVersion: this.ctx.appVersion,
        capture: {
          deviceWallTime: clock.wallTime,
          monotonicElapsedMs: clock.monotonicMs,
          bootId: clock.bootId,
          trustedTimeEstimate: trusted.estimate,
          trustedTimeUncertaintyMs: trusted.uncertaintyMs,
          cameraId: shot.cameraId,
          captureProvenance: 'IN_APP_CAMERA',
          captureApi: shot.captureApi,
        },
        image: {
          mimeType: 'image/jpeg',
          byteLength: sealed.byteLength,
          width: sealed.width,
          height: sealed.height,
          sha256: sealed.sha256,
        },
        location,
        cellular,
        motion,
        devicePosture: posture,
        screenRecaptureRisk: screen,
        derivatives: [],
      };
      const issues = validateManifest(manifest);
      if (issues.length)
        throw new EvidenceError(
          `Manifest invalid: ${issues.map((i) => `${i.field} ${i.problem}`).join('; ')}`,
        );
      const manifestSha256 = computeManifestHash(manifest);
      const event = await this.ledger.append(
        'EVIDENCE_CAPTURED',
        { evidenceId, imageSha256: sealed.sha256, manifestSha256, manifest },
        {
          dutySessionId: ids.dutySessionId,
          alsoInTx: async (tx, ev) => {
            await tx.execute(
              `INSERT INTO evidence_manifests (evidence_id, event_id, sealed_path, image_sha256, manifest_sha256, manifest_json, byte_length, upload_state, created_at)
             VALUES (?,?,?,?,?,?,?, 'WAITING_FOR_EVENT_ACK', ?)`,
              [
                evidenceId,
                ev.eventId,
                sealed.sealedPath,
                sealed.sha256,
                manifestSha256,
                JSON.stringify(manifest),
                sealed.byteLength,
                new Date().toISOString(),
              ],
            );
          },
        },
      );
      if (location.mockIndicator === true) {
        await this.ledger.append(
          'LOCATION_MOCK_INDICATOR',
          {
            indicator: true,
            source: location.mockIndicatorSource ?? 'unknown',
            latitude: location.latitude,
            longitude: location.longitude,
          },
          { dutySessionId: ids.dutySessionId },
        );
      }
      return { evidenceId, manifest, manifestSha256, event };
    } catch (e) {
      // Nothing was recorded in the ledger: discard the orphaned sealed file.
      await this.native.discardSealed(sealed.sealedPath).catch(() => undefined);
      throw e;
    }
  }
}
