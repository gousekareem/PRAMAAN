import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requirePermission, type AuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import {
  assignmentScopeSql,
  flagScopeSql,
  officerScopeSql,
  restrictedSessionFilterSql,
} from '../security/access.js';
import { sha256 } from '../security/tokens.js';
import { appendAudit } from '../services/audit.js';
import { DUTY_CATEGORIES, personnelClassLabel } from '../services/duties.js';
import { isoQuery, uuidParam } from './common.js';

export const REPORT_KINDS = ['assignments', 'roster', 'completion', 'exceptions', 'evidence-verification'] as const;
type Kind = (typeof REPORT_KINDS)[number];

interface Column {
  key: string;
  label: string;
  width: number; // relative width for the PDF table
}
interface Report {
  title: string;
  note: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}

const filterSchema = z.object({
  from: isoQuery.optional(),
  to: isoQuery.optional(),
  category: z.enum(DUTY_CATEGORIES).optional(),
  unitId: uuidParam.optional(),
});
type Filters = z.infer<typeof filterSchema>;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function range(f: Filters) {
  const from = f.from ? new Date(f.from) : new Date(Date.now() - 30 * 86_400_000);
  const to = f.to ? new Date(f.to) : new Date(Date.now() + 30 * 86_400_000);
  if (to <= from) throw new AppError(400, 'VALIDATION_FAILED', '`to` must be after `from`.');
  return { from, to };
}

/** Assignment filter shared by the duty-based reports (scope + date range + category + unit). */
function assignmentWhere(u: AuthUser, f: Filters, args: unknown[]): string {
  const { from, to } = range(f);
  const w = [assignmentScopeSql(u, 'a', args), `tstzrange(a.planned_start, a.planned_end) && tstzrange($${args.push(from)}, $${args.push(to)})`];
  if (f.category) w.push(`a.category = $${args.push(f.category)}`);
  if (f.unitId) w.push(`(a.unit_id = $${args.push(f.unitId)} OR a.station_unit_id = $${args.length})`);
  return w.join(' AND ');
}

function showTitle(u: AuthUser, args: unknown[]): string {
  const canR = `$${args.push(u.permissions.has('duty.view_restricted'))}::boolean`;
  const self = `$${args.push(u.officerId)}::uuid`;
  return `CASE WHEN NOT c.is_restricted OR ${canR} OR EXISTS (SELECT 1 FROM duty_assignment_personnel vp WHERE vp.assignment_id = a.id AND vp.officer_id = ${self})
    THEN a.title ELSE c.label || ' (restricted details)' END`;
}

export async function buildReport(ctx: AppContext, u: AuthUser, kind: Kind, f: Filters): Promise<Report> {
  const args: unknown[] = [];
  switch (kind) {
    case 'assignments': {
      const w = assignmentWhere(u, f, args);
      const title = showTitle(u, args);
      const { rows } = await ctx.pool.query(
        `SELECT a.reference_code AS ref, c.label AS category, ${title} AS title, un.name AS unit, a.planned_start AS start, a.planned_end AS "end", a.status,
            (SELECT string_agg(o.display_name || ' (' || p.personnel_class || ')', '; ' ORDER BY o.display_name)
               FROM duty_assignment_personnel p JOIN officers o ON o.id = p.officer_id WHERE p.assignment_id = a.id AND p.status IN ('ASSIGNED','ACCEPTED')) AS personnel,
            sv.display_name AS supervisor,
            (SELECT count(*)::int FROM review_flags f WHERE f.duty_assignment_id = a.id AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')) AS "openExceptions",
            a.is_demo AS demo
           FROM duty_assignments a JOIN duty_categories c ON c.code = a.category JOIN units un ON un.id = a.unit_id
           LEFT JOIN officers sv ON sv.id = a.supervisor_officer_id WHERE ${w} ORDER BY a.planned_start`,
        args,
      );
      return {
        title: 'Duty assignments',
        note: 'Assignment status is supervisory record-keeping and is not proof that anyone physically attended.',
        columns: [
          { key: 'ref', label: 'Reference', width: 1.4 },
          { key: 'category', label: 'Category', width: 1 },
          { key: 'title', label: 'Title', width: 2 },
          { key: 'unit', label: 'Unit', width: 1.4 },
          { key: 'start', label: 'Start', width: 1.3 },
          { key: 'end', label: 'End', width: 1.3 },
          { key: 'status', label: 'Status', width: 1 },
          { key: 'personnel', label: 'Personnel', width: 2.6 },
          { key: 'supervisor', label: 'Supervisor', width: 1.2 },
          { key: 'openExceptions', label: 'Open exc.', width: 0.6 },
        ],
        rows,
      };
    }
    case 'roster': {
      const w = assignmentWhere(u, f, args);
      const title = showTitle(u, args);
      const { rows } = await ctx.pool.query(
        `SELECT o.display_name AS person, o.employee_ref AS "personnelRef", p.personnel_class AS class, un.name AS unit,
            a.reference_code AS ref, c.label AS category, ${title} AS title, a.planned_start AS start, a.planned_end AS "end",
            p.status AS "assignmentStatus", p.role_in_duty AS "roleInDuty", a.status AS "dutyStatus"
           FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id JOIN duty_categories c ON c.code = a.category
           JOIN officers o ON o.id = p.officer_id LEFT JOIN units un ON un.id = o.unit_id
          WHERE ${w} AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status <> 'CANCELLED' ORDER BY a.planned_start, o.display_name`,
        args,
      );
      return {
        title: 'Duty roster',
        note: 'Roster of published and draft duties within your scope.',
        columns: [
          { key: 'person', label: 'Personnel', width: 1.6 },
          { key: 'class', label: 'Class', width: 0.8 },
          { key: 'unit', label: 'Unit', width: 1.4 },
          { key: 'ref', label: 'Duty', width: 1.4 },
          { key: 'category', label: 'Category', width: 1 },
          { key: 'title', label: 'Title', width: 1.8 },
          { key: 'start', label: 'Start', width: 1.3 },
          { key: 'end', label: 'End', width: 1.3 },
          { key: 'roleInDuty', label: 'Role', width: 0.6 },
          { key: 'dutyStatus', label: 'Duty status', width: 0.9 },
        ],
        rows: rows.map((r) => ({ ...r, class: personnelClassLabel(String(r.class)) })),
      };
    }
    case 'completion': {
      const w = assignmentWhere(u, f, args);
      const { rows } = await ctx.pool.query(
        `SELECT c.label AS category, count(*)::int AS total,
            count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
            count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
            count(*) FILTER (WHERE a.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS','DRAFT'))::int AS open,
            count(*) FILTER (WHERE a.status = 'EXCEPTION_REPORTED')::int AS "exceptionReported",
            (SELECT count(*)::int FROM checkins k JOIN duty_assignment_personnel kp ON kp.duty_session_id = k.duty_session_id
               JOIN duty_assignments ka ON ka.id = kp.assignment_id WHERE ka.id = ANY(array_agg(a.id)) AND k.status = 'ACKNOWLEDGED') AS "checkinsOnTime",
            (SELECT count(*)::int FROM checkins k JOIN duty_assignment_personnel kp ON kp.duty_session_id = k.duty_session_id
               JOIN duty_assignments ka ON ka.id = kp.assignment_id WHERE ka.id = ANY(array_agg(a.id)) AND k.status = 'ACKNOWLEDGED_LATE') AS "checkinsLate",
            (SELECT count(*)::int FROM checkins k JOIN duty_assignment_personnel kp ON kp.duty_session_id = k.duty_session_id
               JOIN duty_assignments ka ON ka.id = kp.assignment_id WHERE ka.id = ANY(array_agg(a.id)) AND k.status = 'MISSED') AS "checkinsMissed"
           FROM duty_assignments a JOIN duty_categories c ON c.code = a.category WHERE ${w} GROUP BY c.label, c.code
          ORDER BY array_position(ARRAY['TRAIN_BEAT','STATION_WATCH','VIP_ESCORT','TRACK_INCIDENT'], c.code)`,
        args,
      );
      return {
        title: 'Duty completion',
        note: 'Completed = closed by a supervisor with completion details. Check-in counts come from synchronised device events only.',
        columns: [
          { key: 'category', label: 'Category', width: 1.4 },
          { key: 'total', label: 'Total', width: 0.7 },
          { key: 'completed', label: 'Completed', width: 0.9 },
          { key: 'cancelled', label: 'Cancelled', width: 0.9 },
          { key: 'open', label: 'Open', width: 0.7 },
          { key: 'exceptionReported', label: 'Exception', width: 0.9 },
          { key: 'checkinsOnTime', label: 'Check-ins on time', width: 1.2 },
          { key: 'checkinsLate', label: 'Late', width: 0.7 },
          { key: 'checkinsMissed', label: 'Missed', width: 0.8 },
        ],
        rows,
      };
    }
    case 'exceptions': {
      const { from, to } = range(f);
      const scope = flagScopeSql(u, args);
      const w = [scope, `f.created_at BETWEEN $${args.push(from)} AND $${args.push(to)}`];
      if (f.category) w.push(`fa.category = $${args.push(f.category)}`);
      if (f.unitId) w.push(`fa.unit_id = $${args.push(f.unitId)}`);
      const { rows } = await ctx.pool.query(
        `SELECT f.created_at AS created, f.flag_type AS type, f.severity, f.status, o.display_name AS person, fa.reference_code AS duty,
            f.title, f.resolution_note AS resolution, (SELECT count(*)::int FROM review_flag_notes n WHERE n.flag_id = f.id) AS notes
           FROM review_flags f LEFT JOIN officers o ON o.id = f.officer_id LEFT JOIN duty_assignments fa ON fa.id = f.duty_assignment_id
          WHERE ${w.join(' AND ')} ORDER BY f.created_at`,
        args,
      );
      return {
        title: 'Exceptions',
        note: 'Exceptions are prompts for supervisory review. They are not findings of misconduct.',
        columns: [
          { key: 'created', label: 'Raised', width: 1.3 },
          { key: 'type', label: 'Type', width: 1.6 },
          { key: 'severity', label: 'Severity', width: 0.7 },
          { key: 'status', label: 'Status', width: 0.9 },
          { key: 'person', label: 'Personnel', width: 1.4 },
          { key: 'duty', label: 'Duty', width: 1.4 },
          { key: 'title', label: 'Title', width: 2.4 },
          { key: 'notes', label: 'Notes', width: 0.5 },
          { key: 'resolution', label: 'Resolution', width: 1.8 },
        ],
        rows,
      };
    }
    case 'evidence-verification': {
      const { from, to } = range(f);
      const w = [
        officerScopeSql(u, 'e.officer_id', args),
        restrictedSessionFilterSql(u, 'e.duty_session_id', 'e.officer_id', args),
        `e.created_at BETWEEN $${args.push(from)} AND $${args.push(to)}`,
      ];
      if (f.category) w.push(`xa.category = $${args.push(f.category)}`);
      if (f.unitId) w.push(`xa.unit_id = $${args.push(f.unitId)}`);
      const { rows } = await ctx.pool.query(
        `SELECT e.evidence_id AS id, o.display_name AS person, xa.reference_code AS duty, e.manifest->'capture'->>'deviceWallTime' AS "capturedDevice",
            d.server_received_at AS "receivedServer", e.status, e.verified_at AS "verifiedAt", e.upload_attempts AS attempts,
            left(e.declared_image_sha256, 16) AS "sha256Prefix", (e.screen_risk->>'score') AS "screenRisk"
           FROM evidence_objects e JOIN officers o ON o.id = e.officer_id JOIN device_events d ON d.event_id = e.event_id
           LEFT JOIN duty_assignment_personnel xp ON xp.duty_session_id = e.duty_session_id LEFT JOIN duty_assignments xa ON xa.id = xp.assignment_id
          WHERE ${w.join(' AND ')} ORDER BY e.created_at`,
        args,
      );
      return {
        title: 'Evidence verification',
        note: 'VERIFIED means the stored bytes match the device-signed SHA-256. Integrity is not proof of physical presence.',
        columns: [
          { key: 'id', label: 'Evidence ID', width: 2.2 },
          { key: 'person', label: 'Personnel', width: 1.4 },
          { key: 'duty', label: 'Duty', width: 1.4 },
          { key: 'capturedDevice', label: 'Captured (device)', width: 1.4 },
          { key: 'receivedServer', label: 'Received (server)', width: 1.4 },
          { key: 'status', label: 'Status', width: 1.1 },
          { key: 'attempts', label: 'Uploads', width: 0.6 },
          { key: 'sha256Prefix', label: 'SHA-256 (prefix)', width: 1.3 },
          { key: 'screenRisk', label: 'Screen risk (exp.)', width: 0.8 },
        ],
        rows,
      };
    }
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  return String(v);
}

export function toCsv(r: Report): string {
  const lines = [r.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export async function toPdf(r: Report, meta: { generatedBy: string; filters: Filters; scope: string }): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
    bufferPages: true,
    info: { Title: `PRAMAAN report — ${r.title}`, Author: 'PRAMAAN (academic prototype)', Creator: 'PRAMAAN API' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalW = r.columns.reduce((s, c) => s + c.width, 0);
  const widths = r.columns.map((c) => (c.width / totalW) * usable);
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f2a44');
    let x = left;
    const y = doc.y;
    r.columns.forEach((c, i) => {
      doc.text(c.label, x + 2, y, { width: widths[i]! - 4 });
      x += widths[i]!;
    });
    doc.moveTo(left, doc.y + 2).lineTo(left + usable, doc.y + 2).strokeColor('#8899aa').stroke();
    doc.moveDown(0.4);
  };
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f2a44').text(`PRAMAAN — ${r.title}`);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#333')
    .text(
      `Generated ${new Date().toISOString()} by ${meta.generatedBy} · scope ${meta.scope} · filters ${JSON.stringify(meta.filters)} · ${r.rows.length} rows`,
    )
    .text(r.note)
    .text('All times are UTC. Academic prototype — synthetic demonstration data. Not an official Andhra Pradesh Railway Police record.')
    .moveDown(0.6);
  header();
  doc.font('Helvetica').fontSize(7).fillColor('#111');
  for (const row of r.rows) {
    const cells = r.columns.map((c) => fmt(row[c.key]));
    const hgt = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i]! - 4 }))) + 3;
    if (doc.y + hgt > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      header();
      doc.font('Helvetica').fontSize(7).fillColor('#111');
    }
    const y = doc.y;
    let x = left;
    cells.forEach((t, i) => {
      doc.text(t, x + 2, y, { width: widths[i]! - 4 });
      x += widths[i]!;
    });
    doc.y = y + hgt;
    doc.moveTo(left, doc.y - 1).lineTo(left + usable, doc.y - 1).strokeColor('#e3e7ec').stroke();
  }
  if (!r.rows.length) doc.font('Helvetica-Oblique').fontSize(9).text('No records match these filters.', left);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#666')
      .text(
        `© 2026 SHAIK GOUSE KAREEM. All Rights Reserved. · Page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - doc.page.margins.bottom + 10,
        { width: usable, align: 'center', lineBreak: false },
      );
  }
  doc.end();
  return done;
}

export function reportRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/summary',
    requirePermission('reports.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const f = filterSchema.parse(req.query);
      const out: Record<string, unknown> = {};
      for (const k of REPORT_KINDS) {
        const rep = await buildReport(ctx, u, k, f);
        out[k] = { title: rep.title, rows: rep.rows.length, preview: k === 'completion' ? rep.rows : rep.rows.slice(0, 5) };
      }
      res.json({ generatedAt: new Date().toISOString(), filters: f, reports: out });
    }),
  );

  r.get(
    '/:kind.:format',
    requirePermission('reports.export'),
    h(async (req, res) => {
      const u = authUser(req);
      const kind = z.enum(REPORT_KINDS).parse(req.params.kind);
      const format = z.enum(['csv', 'pdf']).parse(req.params.format);
      const f = filterSchema.parse(req.query);
      const rep = await buildReport(ctx, u, kind, f);
      const body =
        format === 'csv'
          ? Buffer.from(toCsv(rep), 'utf8')
          : await toPdf(rep, { generatedBy: `${u.role} ${u.id}`, filters: f, scope: u.scope.level });
      const digest = sha256(body);
      await withTransaction(ctx.pool, (c) =>
        appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'REPORT_EXPORTED',
          targetType: 'report',
          targetId: kind,
          requestId: reqId(req),
          details: { kind, format, filters: f, rows: rep.rows.length, sha256: digest },
        }),
      );
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pramaan-${kind}.${format}"`);
      res.setHeader('X-Content-SHA256', digest);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(body);
    }),
  );
  return r;
}
