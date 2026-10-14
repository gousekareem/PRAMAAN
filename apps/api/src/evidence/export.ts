import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { buildEvidencePackage } from '@pramaan/verifier';
import { verifyChain, type SignedEvent } from '@pramaan/event-contracts';
import type { AppContext } from '../context.js';
import { AppError } from '../middleware/errors.js';
import { withTransaction } from '../database/pool.js';
import { raiseFlag } from '../services/flags.js';
import { rowToAuditRecord, type AuditRow } from '../services/audit.js';

export interface EvidenceRow {
  evidence_id: string;
  event_id: string;
  device_id: string;
  officer_id: string;
  duty_session_id: string | null;
  declared_image_sha256: string;
  manifest_sha256: string;
  manifest: Record<string, unknown>;
  media_type: string;
  declared_byte_length: number;
  status: string;
  received_byte_length: number | null;
  computed_image_sha256: string | null;
  storage_ref: string | null;
  verification_detail: Record<string, unknown> | null;
  screen_risk: Record<string, unknown> | null;
  upload_attempts: number;
  upload_received_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
}

export async function loadEvidence(ctx: AppContext, id: string): Promise<EvidenceRow> {
  const r = (
    await ctx.pool.query<EvidenceRow>('SELECT * FROM evidence_objects WHERE evidence_id = $1', [id])
  ).rows[0];
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Evidence not found.');
  return r;
}

/** Reads stored bytes and re-verifies SHA-256 on every retrieval/export. */
export async function readVerifiedBytes(ctx: AppContext, ev: EvidenceRow): Promise<Buffer> {
  if (ev.status !== 'VERIFIED' || !ev.storage_ref)
    throw new AppError(409, 'CONFLICT', 'Evidence bytes have not been verified yet.');
  const bytes = await ctx.storage.read(ev.storage_ref, ctx.env.MAX_EVIDENCE_BYTES);
  const h = createHash('sha256').update(bytes).digest('hex');
  if (h !== ev.declared_image_sha256) {
    await withTransaction(ctx.pool, (c) =>
      raiseFlag(c, ctx.bus, {
        type: 'EVIDENCE_HASH_MISMATCH',
        severity: 'HIGH',
        title: 'Stored evidence failed re-verification',
        description:
          'Bytes in server storage no longer match the verified SHA-256 (storage corruption or tampering).',
        dedupeKey: `stored:${ev.evidence_id}:${h}`,
        officerId: ev.officer_id,
        deviceId: ev.device_id,
        evidenceId: ev.evidence_id,
        inputs: { expected: ev.declared_image_sha256, computed: h },
      }),
    );
    throw new AppError(
      500,
      'STORED_EVIDENCE_INTEGRITY_FAILURE',
      'Stored evidence failed integrity re-verification.',
    );
  }
  return bytes;
}

export async function ledgerContext(ctx: AppContext, ev: EvidenceRow): Promise<SignedEvent[]> {
  const { rows } = await ctx.pool.query<{ envelope: SignedEvent }>(
    ev.duty_session_id
      ? 'SELECT envelope FROM device_events WHERE device_id = $1 AND duty_session_id = $2 ORDER BY device_sequence_number LIMIT 5000'
      : 'SELECT envelope FROM device_events WHERE device_id = $1 AND event_id = $2',
    [ev.device_id, ev.duty_session_id ?? ev.event_id],
  );
  return rows.map((r) => r.envelope);
}

export async function custodyRecords(ctx: AppContext, evidenceId: string) {
  const { rows } = await ctx.pool.query<AuditRow>(
    'SELECT * FROM audit_events WHERE evidence_id = $1 ORDER BY sequence LIMIT 1000',
    [evidenceId],
  );
  return rows.map(rowToAuditRecord);
}

export async function buildPackageFor(ctx: AppContext, ev: EvidenceRow, exportedBy: string) {
  const bytes = await readVerifiedBytes(ctx, ev);
  const events = await ledgerContext(ctx, ev);
  const dev = (
    await ctx.pool.query<{
      public_key_spki: string;
      status: string;
      revoked_at: Date | null;
      key_algorithm: string;
    }>('SELECT public_key_spki, status, revoked_at, key_algorithm FROM devices WHERE id = $1', [
      ev.device_id,
    ])
  ).rows[0]!;
  const custody = await custodyRecords(ctx, ev.evidence_id);
  const chain = verifyChain(events);
  return buildEvidencePackage({
    evidenceId: ev.evidence_id,
    generatedBy: exportedBy,
    image: new Uint8Array(bytes),
    manifest: ev.manifest,
    events,
    publicKey: {
      deviceId: ev.device_id,
      publicKeySpkiBase64: dev.public_key_spki,
      algorithm: dev.key_algorithm,
      keyStatus: dev.status,
      revokedAt: dev.revoked_at?.toISOString() ?? null,
    },
    serverVerification: {
      evidenceStatus: ev.status,
      verificationDetail: ev.verification_detail,
      screenRecaptureRisk: ev.screen_risk,
      ledgerChainAtExport: { ok: chain.ok, checked: chain.checked, issues: chain.issues },
      verifiedAt: ev.verified_at?.toISOString() ?? null,
    },
    custody,
  });
}

/** Professional incident/evidence report (PDF). No image content is embedded. */
export async function renderEvidenceReport(
  ctx: AppContext,
  ev: EvidenceRow,
  exportedBy: string,
): Promise<Buffer> {
  const m = ev.manifest as {
    capture: Record<string, unknown>;
    location: Record<string, unknown>;
    image: Record<string, unknown>;
    devicePosture: Record<string, unknown>;
  };
  const officer = (
    await ctx.pool.query<{
      display_name: string;
      employee_ref: string;
      rank: string;
      is_demo: boolean;
    }>('SELECT display_name, employee_ref, rank, is_demo FROM officers WHERE id = $1', [
      ev.officer_id,
    ])
  ).rows[0];
  const event = (
    await ctx.pool.query<{
      device_sequence_number: number;
      previous_event_hash: string;
      event_hash: string;
      server_received_at: Date;
      device_wall_time: Date;
    }>(
      'SELECT device_sequence_number, previous_event_hash, event_hash, server_received_at, device_wall_time FROM device_events WHERE event_id = $1',
      [ev.event_id],
    )
  ).rows[0]!;
  const custody = await custodyRecords(ctx, ev.evidence_id);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `PRAMAAN evidence report ${ev.evidence_id}`,
      Author: 'PRAMAAN (academic prototype)',
      Creator: 'PRAMAAN API',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const H = (t: string) =>
    doc
      .moveDown(0.6)
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#0f2a44')
      .text(t)
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#111');
  const kv = (k: string, v: unknown) =>
    doc
      .font('Helvetica-Bold')
      .text(`${k}: `, { continued: true })
      .font('Courier')
      .text(v === null || v === undefined ? '—' : String(v));
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#0f2a44')
    .text('PRAMAAN — Evidence Verification Report');
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#555')
    .text(
      'Academic capstone prototype. Not an official Guntur Railway Police record. Not a certified chain-of-custody document.',
    );
  if (officer?.is_demo) doc.fillColor('#b45309').text('SYNTHETIC DEMONSTRATION DATA');
  H('Identifiers');
  kv('Evidence ID', ev.evidence_id);
  kv('Ledger event ID', ev.event_id);
  kv('Device ID', ev.device_id);
  kv('Duty session', ev.duty_session_id);
  kv(
    'Officer',
    officer ? `${officer.display_name} (${officer.employee_ref}, ${officer.rank})` : ev.officer_id,
  );
  H('Integrity');
  kv('Server status', ev.status);
  kv('Declared image SHA-256', ev.declared_image_sha256);
  kv('Server-computed SHA-256', ev.computed_image_sha256);
  kv('Manifest SHA-256', ev.manifest_sha256);
  kv('Bytes declared / received', `${ev.declared_byte_length} / ${ev.received_byte_length ?? '—'}`);
  kv('Ledger sequence', event.device_sequence_number);
  kv('Event hash', event.event_hash);
  kv('Previous event hash', event.previous_event_hash);
  kv(
    'Device signature',
    'ECDSA P-256 / SHA-256 — verified at ingestion against the registered device key',
  );
  H('Time (sources kept separate)');
  kv('Device wall-clock (untrusted)', m.capture.deviceWallTime);
  kv('Trusted-time estimate', m.capture.trustedTimeEstimate);
  kv('Estimate uncertainty (ms)', m.capture.trustedTimeUncertaintyMs);
  kv('Server receipt time', event.server_received_at.toISOString());
  kv('Evidence verified at (server)', ev.verified_at?.toISOString() ?? null);
  H('Location (as reported by the device)');
  kv('Availability', m.location.availability);
  kv(
    'Latitude, longitude',
    m.location.latitude !== null ? `${m.location.latitude}, ${m.location.longitude}` : null,
  );
  kv('Horizontal accuracy (m)', m.location.horizontalAccuracyM);
  kv('Provider', m.location.provider);
  kv('Mock indicator (client-reported)', m.location.mockIndicator);
  H('Device posture (heuristic, bypassable)');
  kv('Root indicators', JSON.stringify(m.devicePosture.rootIndicators));
  kv('Debuggable build', m.devicePosture.debuggableBuild);
  kv('Key hardware-backed', m.devicePosture.keyHardwareBacked);
  kv(
    'Screen re-capture risk (EXPERIMENTAL)',
    ev.screen_risk ? JSON.stringify(ev.screen_risk) : null,
  );
  H('Chain-of-custody records');
  for (const r of custody.slice(0, 40))
    doc
      .font('Courier')
      .fontSize(7.5)
      .text(
        `#${r.sequence} ${r.occurredAt} ${r.action} by ${r.actorRole ?? 'system'} hash=${r.recordHash.slice(0, 16)}…`,
      );
  H('Interpretation');
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      'A matching SHA-256 confirms the stored bytes are identical to those hashed on the device and declared in a signed ledger event. ' +
        'It does NOT prove that the scene, time, location or identity are genuine, nor does it establish legal admissibility. ' +
        'Device-reported times and locations can be manipulated on compromised devices. Human review is required.',
    );
  doc
    .moveDown()
    .fontSize(8)
    .fillColor('#555')
    .text(
      `Report generated ${new Date().toISOString()} by ${exportedBy}. © 2026 SHAIK GOUSE KAREEM. All Rights Reserved.`,
    );
  doc.end();
  return done;
}
