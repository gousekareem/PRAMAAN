import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import { unzipSync, zipSync } from 'fflate';
import { verifyPackageZip } from '@pramaan/verifier';
import type { AppContext } from '../context.js';
import { activeDevice, bearer, DEMO, mobileLogin, PF1, setupTestApp, webLogin } from './helpers.js';
import type { SimulatedDevice } from '../tools/sim-device.js';

let ctx: AppContext;
let app: Express;
let officer: string;
let admin: string;
let sup: string;
let reviewer: string;
let dev: SimulatedDevice;
const D1 = DEMO.duties.d1;

beforeAll(async () => {
  ({ ctx, app } = await setupTestApp());
  officer = (await mobileLogin(app, DEMO.emails.officer1)).token;
  admin = (await webLogin(app, DEMO.emails.admin)).token;
  sup = (await webLogin(app, DEMO.emails.supervisor)).token;
  reviewer = (await webLogin(app, DEMO.emails.reviewer)).token;
  dev = await activeDevice(app, officer, admin);
});
afterAll(async () => ctx.pool.end());

const upload = (id: string, bytes: Buffer, token = officer) =>
  request(app)
    .put(`/api/v1/sync/evidence/${id}`)
    .set(bearer(token))
    .attach('file', bytes, { filename: 'capture.jpg', contentType: 'image/jpeg' });

async function captured() {
  const ev = dev.evidence({ dutySessionId: D1, lat: PF1.lat, lon: PF1.lon });
  const r = await request(app)
    .post('/api/v1/sync/batch')
    .set(bearer(officer))
    .send(dev.batch([ev.event]));
  expect(r.body.results[0].status).toBe('ACCEPTED');
  return ev;
}

describe('evidence upload verification', () => {
  it('refuses bytes for which no signed capture event exists', async () => {
    const ev = dev.evidence({ dutySessionId: D1, lat: PF1.lat, lon: PF1.lon });
    dev.seq -= 1; // event never sent; keep chain consistent for later tests
    dev.prevHash = ev.event.previousEventHash;
    const r = await upload(ev.evidenceId, ev.image);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('EVIDENCE_EVENT_NOT_FOUND');
  });

  it('verifies matching bytes server-side and is idempotent', async () => {
    const ev = await captured();
    const r = await upload(ev.evidenceId, ev.image);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'VERIFIED', sha256: ev.manifest.image.sha256 });
    expect((await upload(ev.evidenceId, ev.image)).body.alreadyVerified).toBe(true);
    const row = (
      await ctx.pool.query(
        'SELECT status, computed_image_sha256, screen_risk FROM evidence_objects WHERE evidence_id = $1',
        [ev.evidenceId],
      )
    ).rows[0];
    expect(row.status).toBe('VERIFIED');
    expect(row.screen_risk.experimental).toBe(true);
  });

  it('quarantines modified bytes, raises a HIGH flag, and accepts a correct retry', async () => {
    const ev = await captured();
    const modified = Buffer.from(ev.image);
    modified[modified.length - 10] = modified[modified.length - 10]! ^ 0xff;
    const bad = await upload(ev.evidenceId, modified);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('EVIDENCE_HASH_MISMATCH');
    const row = (
      await ctx.pool.query(
        'SELECT status, storage_ref FROM evidence_objects WHERE evidence_id = $1',
        [ev.evidenceId],
      )
    ).rows[0];
    expect(row.status).toBe('QUARANTINED');
    expect(row.storage_ref).toMatch(/^quarantine\//);
    expect(
      (
        await ctx.pool.query(
          "SELECT severity FROM review_flags WHERE evidence_id = $1 AND flag_type = 'EVIDENCE_HASH_MISMATCH'",
          [ev.evidenceId],
        )
      ).rows[0].severity,
    ).toBe('HIGH');
    expect((await upload(ev.evidenceId, ev.image)).body.status).toBe('VERIFIED');
  });

  it('rejects oversize uploads and non-JPEG content', async () => {
    const ev = await captured();
    const big = await upload(ev.evidenceId, Buffer.alloc(600 * 1024, 1));
    expect(big.status).toBe(413);
    const notJpeg = await upload(ev.evidenceId, Buffer.from('GIF89a' + 'x'.repeat(100)));
    expect(notJpeg.status).toBe(422);
  });

  it('blocks a client from relabelling evidence into another officer’s record', async () => {
    const ev = await captured();
    const other = (await mobileLogin(app, DEMO.emails.officer2)).token;
    expect((await upload(ev.evidenceId, ev.image, other)).status).toBe(404);
  });

  it('rejects a capture event whose manifest hash does not bind to the manifest', async () => {
    const ev = dev.evidence({ dutySessionId: D1, lat: PF1.lat, lon: PF1.lon });
    dev.seq -= 1;
    dev.prevHash = ev.event.previousEventHash;
    const p = ev.event.payload as { manifest: { location: { latitude: number } } };
    p.manifest.location.latitude = 16.31; // edit manifest without updating manifestSha256
    const fixed = dev.event('EVIDENCE_CAPTURED', ev.event.payload, { dutySessionId: D1 });
    const r = await request(app)
      .post('/api/v1/sync/batch')
      .set(bearer(officer))
      .send(dev.batch([fixed]));
    expect(r.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'INVALID_MANIFEST' });
  });
});

describe('evidence access, export and independent verification', () => {
  let evidenceId: string;
  let image: Buffer;
  beforeAll(async () => {
    dev = await activeDevice(app, officer, admin); // clean chain (earlier tests deliberately left a rejected-event gap)
    const ev = await captured();
    await upload(ev.evidenceId, ev.image).expect(200);
    evidenceId = ev.evidenceId;
    image = ev.image;
  });

  it('restricts image content to supervisors/admins and audits access', async () => {
    expect(
      (await request(app).get(`/api/v1/evidence/${evidenceId}/content`).set(bearer(reviewer)))
        .status,
    ).toBe(403);
    const meta = await request(app).get(`/api/v1/evidence/${evidenceId}`).set(bearer(reviewer));
    expect(meta.status).toBe(200);
    expect(meta.body.canViewImage).toBe(false);
    expect(meta.body.ledger.neighbours.length).toBeGreaterThan(0);
    const r = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/content`)
      .set(bearer(sup))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(Buffer.compare(r.body as Buffer, image)).toBe(0);
    const actions = (
      await ctx.pool.query(
        'SELECT action FROM audit_events WHERE evidence_id = $1 ORDER BY sequence',
        [evidenceId],
      )
    ).rows.map((x) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'EVIDENCE_UPLOAD_VERIFIED',
        'EVIDENCE_METADATA_VIEWED',
        'EVIDENCE_CONTENT_VIEWED',
      ]),
    );
  });

  it('exports a package that the independent verifier PASSes, and FAILs once modified', async () => {
    const r = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/package`)
      .set(bearer(sup))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const zip = new Uint8Array(r.body as Buffer);
    const report = verifyPackageZip(zip);
    expect(report.checks.filter((c) => c.status !== 'PASS')).toEqual([]);
    expect(report.status).toBe('PASS');
    const files = unzipSync(zip);
    const img = files['evidence/original.jpg']!;
    img[200] = img[200]! ^ 1;
    expect(verifyPackageZip(zipSync(files)).status).toBe('FAIL');
    expect(
      (await request(app).get(`/api/v1/evidence/${evidenceId}/package`).set(bearer(reviewer)))
        .status,
    ).toBe(403);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM audit_events WHERE evidence_id = $1 AND action = 'EVIDENCE_EXPORTED'",
          [evidenceId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('renders a PDF report and a JSON manifest export', async () => {
    const pdf = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/report.pdf`)
      .set(bearer(reviewer));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const m = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/manifest.json`)
      .set(bearer(reviewer));
    expect(m.body.manifest.image.sha256).toBe(m.body.manifest.image.sha256);
    expect(m.body.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('re-verifies stored bytes on retrieval and detects storage tampering', async () => {
    const ref = (
      await ctx.pool.query('SELECT storage_ref FROM evidence_objects WHERE evidence_id = $1', [
        evidenceId,
      ])
    ).rows[0].storage_ref as string;
    const path = join(ctx.storage.root, ref);
    expect(statSync(path).size).toBe(image.length);
    const corrupt = Buffer.from(image);
    corrupt[50] = corrupt[50]! ^ 0xff;
    writeFileSync(path, corrupt);
    const r = await request(app).get(`/api/v1/evidence/${evidenceId}/content`).set(bearer(sup));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('STORED_EVIDENCE_INTEGRITY_FAILURE');
    writeFileSync(path, image);
    expect(readdirSync(join(ctx.storage.root, 'verified')).length).toBeGreaterThan(0);
  });

  it('evidence declarations are immutable in the database', async () => {
    await expect(
      ctx.pool.query(
        "UPDATE evidence_objects SET declared_image_sha256 = repeat('a', 64) WHERE evidence_id = $1",
        [evidenceId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      ctx.pool.query('DELETE FROM evidence_objects WHERE evidence_id = $1', [evidenceId]),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it('lists and filters evidence by hash prefix', async () => {
    const r = await request(app)
      .get(
        `/api/v1/evidence?hash=${image.length ? (await ctx.pool.query('SELECT declared_image_sha256 h FROM evidence_objects WHERE evidence_id = $1', [evidenceId])).rows[0].h.slice(0, 10) : ''}`,
      )
      .set(bearer(reviewer));
    expect(r.body.items.map((x: { evidenceId: string }) => x.evidenceId)).toContain(evidenceId);
  });
});
