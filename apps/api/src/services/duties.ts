import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { EventBus } from '../events/bus.js';
import { AppError } from '../middleware/errors.js';
import { appendAudit } from './audit.js';
import { raiseFlag } from './flags.js';
import { notifyOfficers, notifyUsers } from './notifications.js';

export const DUTY_CATEGORIES = ['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'] as const;
export type DutyCategory = (typeof DUTY_CATEGORIES)[number];
export const DUTY_STATUSES = [
  'DRAFT',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'EXCEPTION_REPORTED',
  'CANCELLED',
] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

/**
 * Valid duty state transitions. COMPLETED and CANCELLED are terminal. IN_PROGRESS is normally set
 * when an assigned person's device reports DUTY_SESSION_STARTED; an assignment status is never
 * treated as proof that anyone physically attended.
 */
export const TRANSITIONS: Record<DutyStatus, DutyStatus[]> = {
  DRAFT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'IN_PROGRESS', 'EXCEPTION_REPORTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'EXCEPTION_REPORTED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'EXCEPTION_REPORTED'],
  EXCEPTION_REPORTED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const ACTIVE_ASSIGNMENT_STATUSES = ['DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'EXCEPTION_REPORTED'];
const PREFIX: Record<DutyCategory, string> = {
  TRAIN_BEAT: 'TB',
  STATION_WATCH: 'SW',
  VIP_ESCORT: 'VE',
  TRACK_INCIDENT: 'TI',
};

export interface Actor {
  id: string | null;
  role: string;
  requestId?: string | null;
}

export interface CategoryPolicy {
  code: DutyCategory;
  label: string;
  is_restricted: boolean;
  min_personnel: number;
  requires_supervisor: boolean;
  accept_required: boolean;
  eligibility_mode: 'BLOCK' | 'WARN';
  checkin_min_interval_min: number;
  checkin_max_interval_min: number;
  response_window_sec: number;
  reporting_window_min: number;
  grace_min: number;
  max_duration_hours: number;
  policy_version: number;
  eligible: string[];
}

export interface AssignmentRow {
  id: string;
  reference_code: string;
  category: DutyCategory;
  title: string;
  unit_id: string;
  station_unit_id: string | null;
  planned_start: Date;
  planned_end: Date;
  status: DutyStatus;
  accept_required: boolean;
  created_by: string;
  supervisor_officer_id: string | null;
  is_demo: boolean;
  version: number;
}

interface OfficerRow {
  id: string;
  display_name: string;
  is_active: boolean;
  personnel_category: 'POLICE' | 'HOME_GUARD';
  rank: string | null;
  constable_category: 'AR' | 'GENERAL' | null;
  unit_id: string | null;
}

export interface Conflict {
  type: 'ASSIGNMENT' | 'LEGACY_SESSION' | 'UNAVAILABLE';
  id: string;
  reference: string;
  start: string;
  end: string;
  detail: string;
}

/** HG, PC_AR, PC_GENERAL, PC (subtype not recorded), HC, ASI, SI, CI, DSP, OTHER. */
export function personnelClass(o: Pick<OfficerRow, 'personnel_category' | 'rank' | 'constable_category'>): string {
  if (o.personnel_category === 'HOME_GUARD') return 'HG';
  if (o.rank === 'PC') return o.constable_category ? `PC_${o.constable_category}` : 'PC';
  return o.rank ?? 'OTHER';
}

export function personnelClassLabel(cls: string): string {
  switch (cls) {
    case 'HG':
      return 'HG — Home Guard';
    case 'PC_AR':
      return 'PC — Armed Reserve';
    case 'PC_GENERAL':
      return 'PC — General';
    case 'PC':
      return 'PC — Police Constable';
    default:
      return cls;
  }
}

export async function loadCategory(db: pg.Pool | pg.PoolClient, code: string): Promise<CategoryPolicy> {
  const { rows } = await db.query<CategoryPolicy>(
    `SELECT c.*, COALESCE((SELECT array_agg(e.personnel_class ORDER BY e.personnel_class) FROM duty_category_eligibility e WHERE e.category_code = c.code), '{}') AS eligible
       FROM duty_categories c WHERE c.code = $1`,
    [code],
  );
  if (!rows[0]) throw new AppError(400, 'VALIDATION_FAILED', `Unknown duty category ${code}.`);
  return rows[0];
}

export async function lockAssignment(c: pg.PoolClient, id: string): Promise<AssignmentRow> {
  const r = (await c.query<AssignmentRow>('SELECT * FROM duty_assignments WHERE id = $1 FOR UPDATE', [id]))
    .rows[0];
  if (!r) throw new AppError(404, 'NOT_FOUND', 'Duty assignment not found.');
  return r;
}

async function recordChange(
  c: pg.PoolClient,
  actor: Actor,
  assignmentId: string,
  type: string,
  before: unknown,
  after: unknown,
  reason: string | null,
): Promise<void> {
  await c.query(
    `INSERT INTO duty_assignment_changes (id, assignment_id, change_type, before_value, after_value, reason, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      assignmentId,
      type,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      reason,
      actor.id,
    ],
  );
}

async function audit(
  c: pg.PoolClient,
  actor: Actor,
  action: string,
  assignmentId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await appendAudit(c, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    targetType: 'duty_assignment',
    targetId: assignmentId,
    requestId: actor.requestId ?? null,
    details,
  });
}

async function nextReference(c: pg.PoolClient, category: DutyCategory, start: Date, demo: boolean): Promise<string> {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('pramaan-duty-ref'))");
  const ymd = start.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${demo ? 'DEMO-' : ''}${PREFIX[category]}-${ymd}-`;
  const { rows } = await c.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM duty_assignments WHERE reference_code LIKE $1',
    [`${prefix}%`],
  );
  return `${prefix}${String(rows[0]!.n + 1).padStart(3, '0')}`;
}

export interface CreateAssignmentInput {
  category: DutyCategory;
  title: string;
  unitId: string;
  plannedStart: Date;
  plannedEnd: Date;
  reportingLocation?: string | null;
  trainRef?: string | null;
  stationUnitId?: string | null;
  escortLabel?: string | null;
  incidentRef?: string | null;
  notes?: string | null;
  supervisorOfficerId?: string | null;
  acceptRequired?: boolean;
  isDemo?: boolean;
  referenceCode?: string;
  /** Optional fixed id (deterministic demo seed). */
  id?: string;
}

export async function createAssignment(
  c: pg.PoolClient,
  actor: Actor & { id: string },
  input: CreateAssignmentInput,
): Promise<string> {
  const cat = await loadCategory(c, input.category);
  if (input.plannedEnd <= input.plannedStart)
    throw new AppError(400, 'VALIDATION_FAILED', 'plannedEnd must be after plannedStart.');
  if (input.plannedEnd.getTime() - input.plannedStart.getTime() > cat.max_duration_hours * 3600_000)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `A ${cat.label} duty may not exceed ${cat.max_duration_hours} hours (configured policy).`,
    );
  const unit = (await c.query('SELECT 1 FROM units WHERE id = $1 AND is_active', [input.unitId])).rowCount;
  if (!unit) throw new AppError(400, 'VALIDATION_FAILED', 'Unit not found or inactive.');
  if (input.stationUnitId) {
    const st = await c.query("SELECT 1 FROM units WHERE id = $1 AND unit_type = 'STATION'", [input.stationUnitId]);
    if (!st.rowCount) throw new AppError(400, 'VALIDATION_FAILED', 'stationUnitId must reference a station unit.');
  }
  if (input.supervisorOfficerId) {
    const sv = await c.query<{ is_active: boolean }>('SELECT is_active FROM officers WHERE id = $1', [
      input.supervisorOfficerId,
    ]);
    if (!sv.rows[0]?.is_active)
      throw new AppError(400, 'INACTIVE_PERSONNEL', 'Supervisor not found or inactive.');
  }
  const id = input.id ?? randomUUID();
  const ref = input.referenceCode ?? (await nextReference(c, input.category, input.plannedStart, !!input.isDemo));
  await c.query(
    `INSERT INTO duty_assignments (id, reference_code, category, title, unit_id, planned_start, planned_end, reporting_location, train_ref,
       station_unit_id, escort_label, incident_ref, notes, supervisor_officer_id, accept_required, policy_version, created_by, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id,
      ref,
      input.category,
      input.title,
      input.unitId,
      input.plannedStart,
      input.plannedEnd,
      input.reportingLocation ?? null,
      input.trainRef ?? null,
      input.stationUnitId ?? null,
      input.escortLabel ?? null,
      input.incidentRef ?? null,
      input.notes ?? null,
      input.supervisorOfficerId ?? null,
      input.acceptRequired ?? cat.accept_required,
      cat.policy_version,
      actor.id,
      !!input.isDemo,
    ],
  );
  await recordChange(c, actor, id, 'CREATED', null, { referenceCode: ref, category: input.category }, null);
  await audit(c, actor, 'DUTY_ASSIGNMENT_CREATED', id, {
    referenceCode: ref,
    category: input.category,
    plannedStart: input.plannedStart.toISOString(),
    plannedEnd: input.plannedEnd.toISOString(),
    unitId: input.unitId,
  });
  return id;
}

/** Overlapping duties (assignments and PRAMAAN 1.0 sessions) and unavailability for one person. */
export async function findConflicts(
  db: pg.Pool | pg.PoolClient,
  officerId: string,
  start: Date,
  end: Date,
  excludeAssignmentId: string | null,
): Promise<Conflict[]> {
  const out: Conflict[] = [];
  const a = await db.query<{ id: string; reference_code: string; planned_start: Date; planned_end: Date; status: string }>(
    `SELECT a.id, a.reference_code, a.planned_start, a.planned_end, a.status
       FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
      WHERE p.officer_id = $1 AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status = ANY($4::text[])
        AND ($5::uuid IS NULL OR a.id <> $5::uuid)
        AND tstzrange(a.planned_start, a.planned_end) && tstzrange($2, $3)`,
    [officerId, start, end, ACTIVE_ASSIGNMENT_STATUSES, excludeAssignmentId],
  );
  for (const r of a.rows)
    out.push({
      type: 'ASSIGNMENT',
      id: r.id,
      reference: r.reference_code,
      start: r.planned_start.toISOString(),
      end: r.planned_end.toISOString(),
      detail: `Overlaps duty ${r.reference_code} (${r.status}).`,
    });
  const s = await db.query<{ id: string; planned_start: Date; planned_end: Date; status: string }>(
    `SELECT s.id, s.planned_start, s.planned_end, s.status FROM duty_sessions s
      WHERE s.officer_id = $1 AND s.status IN ('PLANNED','ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM duty_assignment_personnel p WHERE p.duty_session_id = s.id)
        AND tstzrange(s.planned_start, s.planned_end) && tstzrange($2, $3)`,
    [officerId, start, end],
  );
  for (const r of s.rows)
    out.push({
      type: 'LEGACY_SESSION',
      id: r.id,
      reference: `session ${r.id.slice(0, 8)}`,
      start: r.planned_start.toISOString(),
      end: r.planned_end.toISOString(),
      detail: `Overlaps an individual duty session (${r.status}).`,
    });
  const u = await db.query<{ id: string; starts_at: Date; ends_at: Date; category: string }>(
    `SELECT id, starts_at, ends_at, category FROM personnel_unavailability
      WHERE officer_id = $1 AND cancelled_at IS NULL AND tstzrange(starts_at, ends_at) && tstzrange($2, $3)`,
    [officerId, start, end],
  );
  for (const r of u.rows)
    out.push({
      type: 'UNAVAILABLE',
      id: r.id,
      reference: r.category,
      start: r.starts_at.toISOString(),
      end: r.ends_at.toISOString(),
      detail: `Recorded as unavailable (${r.category}).`,
    });
  return out;
}

async function createSession(
  c: pg.PoolClient,
  actor: Actor,
  a: AssignmentRow,
  officerId: string,
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, assignment_notes, authorized_by, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      officerId,
      a.planned_start,
      a.planned_end,
      `Duty ${a.reference_code}`,
      actor.id ?? a.created_by,
      a.is_demo,
    ],
  );
  // Illustrative zone of the station (or owning unit) for the existing spatial checks.
  await c.query(
    `INSERT INTO duty_zone_assignments (duty_session_id, zone_id)
     SELECT $1, u.geo_zone_id FROM units u WHERE u.id = COALESCE($2::uuid, $3::uuid) AND u.geo_zone_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [id, a.station_unit_id, a.unit_id],
  );
  return id;
}

export interface AddPersonnelOptions {
  officerId: string;
  roleInDuty?: 'LEAD' | 'MEMBER';
  allowConflict?: boolean;
  overrideReason?: string | null;
  /** duty.approve held by the actor: required to override a conflict. */
  canOverride: boolean;
  reason?: string | null;
}

export async function addPersonnel(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  o: AddPersonnelOptions,
): Promise<{ personnelId: string; warnings: string[]; conflicts: Conflict[] }> {
  const a = await lockAssignment(c, assignmentId);
  if (a.status === 'COMPLETED' || a.status === 'CANCELLED')
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot change personnel of a ${a.status} duty.`);
  const off = (await c.query<OfficerRow>('SELECT * FROM officers WHERE id = $1', [o.officerId])).rows[0];
  if (!off) throw new AppError(400, 'VALIDATION_FAILED', 'Personnel record not found.');
  if (!off.is_active)
    throw new AppError(400, 'INACTIVE_PERSONNEL', 'Inactive personnel cannot be newly assigned.');
  const cat = await loadCategory(c, a.category);
  const cls = personnelClass(off);
  const warnings: string[] = [];
  if (!cat.eligible.includes(cls)) {
    if (cat.eligibility_mode === 'BLOCK')
      throw new AppError(
        400,
        'NOT_ELIGIBLE',
        `${personnelClassLabel(cls)} is not configured as eligible for ${cat.label} duty.`,
        { personnelClass: cls, eligible: cat.eligible },
      );
    warnings.push(`${personnelClassLabel(cls)} is outside the configured eligibility for ${cat.label}.`);
  }
  const dup = await c.query(
    "SELECT 1 FROM duty_assignment_personnel WHERE assignment_id = $1 AND officer_id = $2 AND status IN ('ASSIGNED','ACCEPTED')",
    [assignmentId, o.officerId],
  );
  if (dup.rowCount) throw new AppError(409, 'CONFLICT', 'This person is already assigned to the duty.');
  const conflicts = await findConflicts(c, o.officerId, a.planned_start, a.planned_end, assignmentId);
  if (conflicts.length) {
    if (!o.allowConflict)
      throw new AppError(409, 'ASSIGNMENT_CONFLICT', 'The person has an overlapping duty or unavailability.', {
        conflicts,
      });
    if (!o.canOverride)
      throw new AppError(403, 'FORBIDDEN', 'Overriding an assignment conflict requires duty.approve.');
    if (!o.overrideReason || o.overrideReason.trim().length < 5)
      throw new AppError(400, 'VALIDATION_FAILED', 'A reason (5+ characters) is required to override a conflict.');
  }
  const pid = randomUUID();
  const sessionId = a.status === 'DRAFT' ? null : await createSession(c, actor, a, o.officerId);
  await c.query(
    `INSERT INTO duty_assignment_personnel (id, assignment_id, officer_id, duty_session_id, role_in_duty, personnel_class, assigned_by, conflict_override_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [pid, assignmentId, o.officerId, sessionId, o.roleInDuty ?? 'MEMBER', cls, actor.id, conflicts.length ? o.overrideReason : null],
  );
  const after = { personnelId: pid, officerId: o.officerId, name: off.display_name, personnelClass: cls, roleInDuty: o.roleInDuty ?? 'MEMBER' };
  await recordChange(c, actor, assignmentId, 'PERSONNEL_ADDED', null, after, o.reason ?? o.overrideReason ?? null);
  await audit(c, actor, 'DUTY_PERSONNEL_ADDED', assignmentId, {
    ...after,
    conflicts: conflicts.map((x) => ({ type: x.type, reference: x.reference })),
    overrideReason: conflicts.length ? o.overrideReason : null,
  });
  if (conflicts.length)
    await raiseFlag(c, bus, {
      type: 'ASSIGNMENT_CONFLICT',
      severity: 'MEDIUM',
      title: 'Assignment approved despite a conflict',
      description: `${off.display_name} was assigned to ${a.reference_code} although it overlaps: ${conflicts
        .map((x) => x.detail)
        .join(' ')} Override reason: ${o.overrideReason}`,
      dedupeKey: `conflict:${pid}`,
      officerId: o.officerId,
      dutyAssignmentId: assignmentId,
      inputs: { conflicts, overrideReason: o.overrideReason },
    });
  if (a.status !== 'DRAFT')
    await notifyOfficers(c, bus, [o.officerId], {
      kind: 'ASSIGNMENT',
      title: `New duty ${a.reference_code}`,
      body: `You were assigned to ${a.title} (${a.planned_start.toISOString()} – ${a.planned_end.toISOString()}).`,
      relatedType: 'duty_assignment',
      relatedId: assignmentId,
      dedupeKey: `assign:${pid}`,
    });
  return { personnelId: pid, warnings, conflicts };
}

async function retireSession(c: pg.PoolClient, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  // Only a session that never started is cancelled; an ACTIVE session is ended by the device.
  await c.query("UPDATE duty_sessions SET status = 'CANCELLED' WHERE id = $1 AND status = 'PLANNED'", [sessionId]);
}

export async function removePersonnel(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  personnelId: string,
  reason: string,
  replacedById: string | null = null,
): Promise<void> {
  const a = await lockAssignment(c, assignmentId);
  if (a.status === 'COMPLETED' || a.status === 'CANCELLED')
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot change personnel of a ${a.status} duty.`);
  const p = (
    await c.query<{ id: string; officer_id: string; status: string; duty_session_id: string | null }>(
      'SELECT id, officer_id, status, duty_session_id FROM duty_assignment_personnel WHERE id = $1 AND assignment_id = $2 FOR UPDATE',
      [personnelId, assignmentId],
    )
  ).rows[0];
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Assigned person not found on this duty.');
  if (p.status === 'REMOVED' || p.status === 'REPLACED')
    throw new AppError(409, 'CONFLICT', 'This person is no longer assigned.');
  const status = replacedById ? 'REPLACED' : 'REMOVED';
  await c.query(
    `UPDATE duty_assignment_personnel SET status = $2, removed_by = $3, removed_at = now(), removal_reason = $4, replaced_by_id = $5 WHERE id = $1`,
    [personnelId, status, actor.id, reason, replacedById],
  );
  await retireSession(c, p.duty_session_id);
  await recordChange(
    c,
    actor,
    assignmentId,
    replacedById ? 'PERSONNEL_REPLACED' : 'PERSONNEL_REMOVED',
    { personnelId, officerId: p.officer_id, status: p.status },
    { status, replacedById },
    reason,
  );
  await audit(c, actor, replacedById ? 'DUTY_PERSONNEL_REPLACED' : 'DUTY_PERSONNEL_REMOVED', assignmentId, {
    personnelId,
    officerId: p.officer_id,
    reason,
    replacedById,
  });
  if (a.status !== 'DRAFT')
    await notifyOfficers(c, bus, [p.officer_id], {
      kind: 'ASSIGNMENT_CHANGED',
      title: `Removed from duty ${a.reference_code}`,
      body: `You are no longer assigned to ${a.reference_code}. Reason: ${reason}`,
      relatedType: 'duty_assignment',
      relatedId: assignmentId,
      dedupeKey: `remove:${personnelId}`,
    });
}

export async function replacePersonnel(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  personnelId: string,
  opts: Omit<AddPersonnelOptions, 'reason'> & { reason: string },
): Promise<{ personnelId: string; warnings: string[]; conflicts: Conflict[] }> {
  const old = (
    await c.query<{ role_in_duty: 'LEAD' | 'MEMBER' }>(
      'SELECT role_in_duty FROM duty_assignment_personnel WHERE id = $1 AND assignment_id = $2',
      [personnelId, assignmentId],
    )
  ).rows[0];
  if (!old) throw new AppError(404, 'NOT_FOUND', 'Assigned person not found on this duty.');
  const added = await addPersonnel(c, bus, actor, assignmentId, {
    ...opts,
    roleInDuty: opts.roleInDuty ?? old.role_in_duty,
  });
  await removePersonnel(c, bus, actor, assignmentId, personnelId, opts.reason, added.personnelId);
  return added;
}

export interface TransitionInput {
  to: DutyStatus;
  reason?: string | null;
  completionNote?: string | null;
}

export async function transition(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor,
  assignmentId: string,
  t: TransitionInput,
): Promise<DutyStatus> {
  const a = await lockAssignment(c, assignmentId);
  if (!TRANSITIONS[a.status].includes(t.to))
    throw new AppError(409, 'INVALID_TRANSITION', `A ${a.status} duty cannot move to ${t.to}.`, {
      allowed: TRANSITIONS[a.status],
    });
  const active = (
    await c.query<{ id: string; officer_id: string; duty_session_id: string | null; status: string }>(
      "SELECT id, officer_id, duty_session_id, status FROM duty_assignment_personnel WHERE assignment_id = $1 AND status IN ('ASSIGNED','ACCEPTED')",
      [assignmentId],
    )
  ).rows;
  if ((t.to === 'CANCELLED' || t.to === 'EXCEPTION_REPORTED') && (!t.reason || t.reason.trim().length < 5))
    throw new AppError(400, 'VALIDATION_FAILED', 'A reason (5+ characters) is required.');
  if (t.to === 'COMPLETED' && (!t.completionNote || t.completionNote.trim().length < 5))
    throw new AppError(400, 'VALIDATION_FAILED', 'Completion details (5+ characters) are required.');
  if (t.to === 'ASSIGNED') {
    if (!active.length)
      throw new AppError(409, 'INVALID_TRANSITION', 'Assign at least one person before publishing the duty.');
    for (const p of active)
      if (!p.duty_session_id) {
        const sid = await createSession(c, actor, a, p.officer_id);
        await c.query('UPDATE duty_assignment_personnel SET duty_session_id = $2 WHERE id = $1', [p.id, sid]);
      }
  }
  if (t.to === 'CANCELLED' || t.to === 'COMPLETED')
    for (const p of active) await retireSession(c, p.duty_session_id);
  await c.query(
    `UPDATE duty_assignments SET status = $2, version = version + 1,
        completion_note = CASE WHEN $2 = 'COMPLETED' THEN $3 ELSE completion_note END,
        completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END,
        completed_by = CASE WHEN $2 = 'COMPLETED' THEN $4::uuid ELSE completed_by END,
        cancelled_reason = CASE WHEN $2 = 'CANCELLED' THEN $5 ELSE cancelled_reason END
      WHERE id = $1`,
    [assignmentId, t.to, t.completionNote ?? null, actor.id, t.reason ?? null],
  );
  await recordChange(c, actor, assignmentId, 'STATUS_CHANGED', { status: a.status }, { status: t.to }, t.reason ?? t.completionNote ?? null);
  await audit(c, actor, 'DUTY_STATUS_CHANGED', assignmentId, {
    from: a.status,
    to: t.to,
    reason: t.reason ?? null,
    completionNote: t.completionNote ?? null,
  });
  if (t.to === 'EXCEPTION_REPORTED')
    await raiseFlag(c, bus, {
      type: 'DUTY_EXCEPTION_REPORTED',
      severity: 'MEDIUM',
      title: `Exception reported on ${a.reference_code}`,
      description: `${t.reason} (An exception is a prompt for supervisory review, not a finding of misconduct.)`,
      dedupeKey: `dutyexc:${assignmentId}:${Date.now()}`,
      officerId: active[0]?.officer_id ?? null,
      dutyAssignmentId: assignmentId,
      inputs: { reason: t.reason },
    });
  const notifyKinds: Partial<Record<DutyStatus, string>> = {
    ASSIGNED: `Duty ${a.reference_code} published`,
    CANCELLED: `Duty ${a.reference_code} cancelled`,
  };
  const title = notifyKinds[t.to];
  if (title)
    await notifyOfficers(
      c,
      bus,
      active.map((p) => p.officer_id),
      {
        kind: t.to === 'ASSIGNED' ? 'ASSIGNMENT' : 'ASSIGNMENT_CHANGED',
        title,
        body:
          t.to === 'ASSIGNED'
            ? `${a.title}: ${a.planned_start.toISOString()} – ${a.planned_end.toISOString()}.`
            : `Reason: ${t.reason}`,
        relatedType: 'duty_assignment',
        relatedId: assignmentId,
        dedupeKey: `status:${assignmentId}:${t.to}`,
      },
    );
  if (bus)
    setImmediate(() =>
      bus.publish({ type: 'duty-updated', assignmentId, status: t.to, at: new Date().toISOString() }),
    );
  return t.to;
}

export interface UpdateAssignmentInput {
  plannedStart?: Date;
  plannedEnd?: Date;
  title?: string;
  reportingLocation?: string | null;
  trainRef?: string | null;
  stationUnitId?: string | null;
  escortLabel?: string | null;
  incidentRef?: string | null;
  notes?: string | null;
  supervisorOfficerId?: string | null;
  reason?: string | null;
  allowConflict?: boolean;
  canOverride: boolean;
}

export async function updateAssignment(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  u: UpdateAssignmentInput,
): Promise<{ conflicts: Conflict[] }> {
  const a = await lockAssignment(c, assignmentId);
  if (!['DRAFT', 'ASSIGNED', 'ACCEPTED'].includes(a.status))
    throw new AppError(409, 'INVALID_TRANSITION', `A ${a.status} duty can no longer be edited; record a correction instead.`);
  if (a.status !== 'DRAFT' && (!u.reason || u.reason.trim().length < 5))
    throw new AppError(400, 'VALIDATION_FAILED', 'A reason is required to change a published duty.');
  const cat = await loadCategory(c, a.category);
  const start = u.plannedStart ?? a.planned_start;
  const end = u.plannedEnd ?? a.planned_end;
  const scheduleChanged = start.getTime() !== a.planned_start.getTime() || end.getTime() !== a.planned_end.getTime();
  const conflicts: Conflict[] = [];
  if (scheduleChanged) {
    if (end <= start) throw new AppError(400, 'VALIDATION_FAILED', 'plannedEnd must be after plannedStart.');
    if (end.getTime() - start.getTime() > cat.max_duration_hours * 3600_000)
      throw new AppError(400, 'VALIDATION_FAILED', `Duty may not exceed ${cat.max_duration_hours} hours.`);
    const people = (
      await c.query<{ officer_id: string }>(
        "SELECT officer_id FROM duty_assignment_personnel WHERE assignment_id = $1 AND status IN ('ASSIGNED','ACCEPTED')",
        [assignmentId],
      )
    ).rows;
    for (const p of people) conflicts.push(...(await findConflicts(c, p.officer_id, start, end, assignmentId)));
    if (conflicts.length && !u.allowConflict)
      throw new AppError(409, 'ASSIGNMENT_CONFLICT', 'The new schedule overlaps other duties or unavailability.', {
        conflicts,
      });
    if (conflicts.length && !u.canOverride)
      throw new AppError(403, 'FORBIDDEN', 'Overriding an assignment conflict requires duty.approve.');
  }
  const before = {
    plannedStart: a.planned_start.toISOString(),
    plannedEnd: a.planned_end.toISOString(),
  };
  const fields: [string, unknown][] = [];
  if (scheduleChanged) fields.push(['planned_start', start], ['planned_end', end]);
  const map: [keyof UpdateAssignmentInput, string][] = [
    ['title', 'title'],
    ['reportingLocation', 'reporting_location'],
    ['trainRef', 'train_ref'],
    ['stationUnitId', 'station_unit_id'],
    ['escortLabel', 'escort_label'],
    ['incidentRef', 'incident_ref'],
    ['notes', 'notes'],
    ['supervisorOfficerId', 'supervisor_officer_id'],
  ];
  const changedDetails: Record<string, unknown> = {};
  for (const [k, col] of map)
    if (u[k] !== undefined) {
      fields.push([col, u[k]]);
      changedDetails[k] = u[k];
    }
  if (!fields.length) return { conflicts: [] };
  const sets = fields.map(([col], i) => `${col} = $${i + 2}`).join(', ');
  await c.query(`UPDATE duty_assignments SET ${sets}, version = version + 1 WHERE id = $1`, [
    assignmentId,
    ...fields.map(([, v]) => v),
  ]);
  if (scheduleChanged) {
    await c.query(
      `UPDATE duty_sessions s SET planned_start = $2, planned_end = $3 FROM duty_assignment_personnel p
        WHERE p.duty_session_id = s.id AND p.assignment_id = $1 AND s.status = 'PLANNED'`,
      [assignmentId, start, end],
    );
    await recordChange(c, actor, assignmentId, 'SCHEDULE_CHANGED', before, {
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
    }, u.reason ?? null);
    for (const x of conflicts)
      await raiseFlag(c, bus, {
        type: 'ASSIGNMENT_CONFLICT',
        severity: 'MEDIUM',
        title: 'Schedule change approved despite a conflict',
        description: `${a.reference_code}: ${x.detail}`,
        dedupeKey: `sched-conflict:${assignmentId}:${x.type}:${x.id}`,
        dutyAssignmentId: assignmentId,
        inputs: { conflict: x, reason: u.reason },
      });
  }
  if (Object.keys(changedDetails).length)
    await recordChange(c, actor, assignmentId, 'DETAILS_CHANGED', null, changedDetails, u.reason ?? null);
  await audit(c, actor, 'DUTY_ASSIGNMENT_UPDATED', assignmentId, {
    scheduleChanged,
    before: scheduleChanged ? before : undefined,
    changedFields: Object.keys(changedDetails),
    reason: u.reason ?? null,
  });
  if (a.status !== 'DRAFT') {
    const people = (
      await c.query<{ officer_id: string }>(
        "SELECT officer_id FROM duty_assignment_personnel WHERE assignment_id = $1 AND status IN ('ASSIGNED','ACCEPTED')",
        [assignmentId],
      )
    ).rows.map((r) => r.officer_id);
    await notifyOfficers(c, bus, people, {
      kind: 'ASSIGNMENT_CHANGED',
      title: `Duty ${a.reference_code} changed`,
      body: `${scheduleChanged ? `New time ${start.toISOString()} – ${end.toISOString()}. ` : ''}Reason: ${u.reason ?? '—'}`,
      relatedType: 'duty_assignment',
      relatedId: assignmentId,
    });
  }
  return { conflicts };
}

export async function acceptAssignment(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  officerId: string,
  assignmentId: string,
): Promise<{ assignmentStatus: DutyStatus }> {
  const a = await lockAssignment(c, assignmentId);
  if (!['ASSIGNED', 'ACCEPTED'].includes(a.status))
    throw new AppError(409, 'INVALID_TRANSITION', `A ${a.status} duty cannot be accepted.`);
  const p = await c.query(
    "UPDATE duty_assignment_personnel SET status = 'ACCEPTED', accepted_at = now() WHERE assignment_id = $1 AND officer_id = $2 AND status = 'ASSIGNED' RETURNING id",
    [assignmentId, officerId],
  );
  if (!p.rowCount) throw new AppError(409, 'CONFLICT', 'No pending assignment to accept for this person.');
  await recordChange(c, actor, assignmentId, 'PERSONNEL_ACCEPTED', null, { officerId }, null);
  await audit(c, actor, 'DUTY_ACCEPTED', assignmentId, { officerId });
  const pending = await c.query(
    "SELECT 1 FROM duty_assignment_personnel WHERE assignment_id = $1 AND status = 'ASSIGNED'",
    [assignmentId],
  );
  let status = a.status;
  if (!pending.rowCount && a.status === 'ASSIGNED') status = await transition(c, bus, actor, assignmentId, { to: 'ACCEPTED' });
  return { assignmentStatus: status };
}

export async function publishInstructions(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  body: string,
): Promise<{ id: string; version: number }> {
  const a = await lockAssignment(c, assignmentId);
  if (a.status === 'COMPLETED' || a.status === 'CANCELLED')
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot publish instructions for a ${a.status} duty.`);
  const v = (
    await c.query<{ v: number }>('SELECT COALESCE(max(version), 0) + 1 AS v FROM duty_instructions WHERE assignment_id = $1', [
      assignmentId,
    ])
  ).rows[0]!.v;
  const id = randomUUID();
  const sha = createHash('sha256').update(body).digest('hex');
  await c.query(
    'INSERT INTO duty_instructions (id, assignment_id, version, body, body_sha256, published_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, assignmentId, v, body, sha, actor.id],
  );
  await recordChange(c, actor, assignmentId, 'INSTRUCTIONS_PUBLISHED', null, { version: v, bodySha256: sha }, null);
  await audit(c, actor, 'DUTY_INSTRUCTIONS_PUBLISHED', assignmentId, { version: v, bodySha256: sha });
  const people = (
    await c.query<{ officer_id: string }>(
      "SELECT officer_id FROM duty_assignment_personnel WHERE assignment_id = $1 AND status IN ('ASSIGNED','ACCEPTED')",
      [assignmentId],
    )
  ).rows.map((r) => r.officer_id);
  if (a.status !== 'DRAFT')
    await notifyOfficers(c, bus, people, {
      kind: 'INSTRUCTIONS',
      title: `Instructions v${v} for ${a.reference_code}`,
      body: 'New duty instructions were published. Please read and acknowledge them.',
      relatedType: 'duty_assignment',
      relatedId: assignmentId,
      dedupeKey: `instr:${id}`,
    });
  return { id, version: v };
}

export async function acknowledgeInstructions(
  c: pg.PoolClient,
  actor: Actor & { id: string },
  officerId: string,
  instructionId: string,
): Promise<void> {
  const i = (
    await c.query<{ assignment_id: string; version: number }>(
      'SELECT assignment_id, version FROM duty_instructions WHERE id = $1',
      [instructionId],
    )
  ).rows[0];
  if (!i) throw new AppError(404, 'NOT_FOUND', 'Instructions not found.');
  const assigned = await c.query(
    "SELECT 1 FROM duty_assignment_personnel WHERE assignment_id = $1 AND officer_id = $2 AND status IN ('ASSIGNED','ACCEPTED')",
    [i.assignment_id, officerId],
  );
  if (!assigned.rowCount) throw new AppError(404, 'NOT_FOUND', 'Instructions not found.');
  const r = await c.query(
    'INSERT INTO duty_instruction_acks (instruction_id, officer_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [instructionId, officerId, actor.id],
  );
  if (r.rowCount)
    await audit(c, actor, 'DUTY_INSTRUCTIONS_ACKNOWLEDGED', i.assignment_id, {
      instructionId,
      version: i.version,
      officerId,
    });
}

export interface HandoverInput {
  outgoingOfficerId: string;
  incomingOfficerId: string;
  handoverAt: Date;
  outstandingTasks?: string | null;
}

export async function recordHandover(
  c: pg.PoolClient,
  bus: EventBus | null,
  actor: Actor & { id: string },
  assignmentId: string,
  h: HandoverInput,
): Promise<{ id: string; warnings: string[] }> {
  const a = await lockAssignment(c, assignmentId);
  if (!['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'EXCEPTION_REPORTED'].includes(a.status))
    throw new AppError(409, 'INVALID_TRANSITION', `Handover cannot be recorded for a ${a.status} duty.`);
  if (h.outgoingOfficerId === h.incomingOfficerId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Outgoing and incoming personnel must differ.');
  const people = await c.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM officers WHERE id = ANY($1::uuid[])',
    [[h.outgoingOfficerId, h.incomingOfficerId]],
  );
  if (people.rowCount !== 2) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown personnel.');
  if (!people.rows.find((p) => p.id === h.incomingOfficerId)?.is_active)
    throw new AppError(400, 'INACTIVE_PERSONNEL', 'Incoming personnel is inactive.');
  const warnings: string[] = [];
  const onDuty = await c.query<{ officer_id: string }>(
    'SELECT officer_id FROM duty_assignment_personnel WHERE assignment_id = $1 AND officer_id = ANY($2::uuid[])',
    [assignmentId, [h.outgoingOfficerId, h.incomingOfficerId]],
  );
  const listed = new Set(onDuty.rows.map((r) => r.officer_id));
  if (!listed.has(h.outgoingOfficerId)) warnings.push('Outgoing person is not listed on this duty.');
  if (!listed.has(h.incomingOfficerId)) warnings.push('Incoming person is not listed on this duty.');
  const id = randomUUID();
  await c.query(
    `INSERT INTO duty_handovers (id, assignment_id, outgoing_officer_id, incoming_officer_id, handover_at, outstanding_tasks, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, assignmentId, h.outgoingOfficerId, h.incomingOfficerId, h.handoverAt, h.outstandingTasks ?? null, actor.id],
  );
  await recordChange(c, actor, assignmentId, 'HANDOVER_RECORDED', null, { handoverId: id, ...h }, null);
  await audit(c, actor, 'DUTY_HANDOVER_RECORDED', assignmentId, {
    handoverId: id,
    outgoingOfficerId: h.outgoingOfficerId,
    incomingOfficerId: h.incomingOfficerId,
    handoverAt: h.handoverAt.toISOString(),
  });
  await notifyOfficers(c, bus, [h.outgoingOfficerId, h.incomingOfficerId], {
    kind: 'HANDOVER',
    title: `Handover on ${a.reference_code}`,
    body: 'A duty handover involving you was recorded. Please acknowledge it.',
    relatedType: 'duty_assignment',
    relatedId: assignmentId,
    dedupeKey: `handover:${id}`,
  });
  return { id, warnings };
}

export async function acknowledgeHandover(
  c: pg.PoolClient,
  actor: Actor & { id: string },
  officerId: string,
  handoverId: string,
): Promise<'OUTGOING' | 'INCOMING'> {
  const h = (
    await c.query<{ assignment_id: string; outgoing_officer_id: string; incoming_officer_id: string }>(
      'SELECT assignment_id, outgoing_officer_id, incoming_officer_id FROM duty_handovers WHERE id = $1 FOR UPDATE',
      [handoverId],
    )
  ).rows[0];
  if (!h) throw new AppError(404, 'NOT_FOUND', 'Handover not found.');
  const side =
    h.outgoing_officer_id === officerId ? 'OUTGOING' : h.incoming_officer_id === officerId ? 'INCOMING' : null;
  if (!side) throw new AppError(404, 'NOT_FOUND', 'Handover not found.');
  await c.query(
    side === 'OUTGOING'
      ? 'UPDATE duty_handovers SET outgoing_ack_at = COALESCE(outgoing_ack_at, now()) WHERE id = $1'
      : 'UPDATE duty_handovers SET incoming_ack_at = COALESCE(incoming_ack_at, now()) WHERE id = $1',
    [handoverId],
  );
  await audit(c, actor, 'DUTY_HANDOVER_ACKNOWLEDGED', h.assignment_id, { handoverId, side, officerId });
  return side;
}

/** Non-blocking staffing warnings for an assignment (never silently rejects nonstandard staffing). */
export async function assignmentWarnings(db: pg.Pool | pg.PoolClient, assignmentId: string): Promise<string[]> {
  const a = (
    await db.query<AssignmentRow>('SELECT * FROM duty_assignments WHERE id = $1', [assignmentId])
  ).rows[0];
  if (!a) return [];
  const cat = await loadCategory(db, a.category);
  const people = (
    await db.query<{ personnel_class: string; is_active: boolean; display_name: string; status: string }>(
      `SELECT p.personnel_class, p.status, o.is_active, o.display_name FROM duty_assignment_personnel p JOIN officers o ON o.id = p.officer_id
        WHERE p.assignment_id = $1 AND p.status IN ('ASSIGNED','ACCEPTED')`,
      [assignmentId],
    )
  ).rows;
  const w: string[] = [];
  if (['COMPLETED', 'CANCELLED'].includes(a.status)) return w;
  if (people.length < cat.min_personnel)
    w.push(`Fewer personnel (${people.length}) than the configured minimum (${cat.min_personnel}) for ${cat.label}.`);
  if (cat.requires_supervisor && !a.supervisor_officer_id)
    w.push(`No supervising officer recorded (configured as expected for ${cat.label}).`);
  for (const p of people) {
    if (!p.is_active) w.push(`${p.display_name} is now inactive but still assigned.`);
    if (!cat.eligible.includes(p.personnel_class))
      w.push(`${p.display_name} (${personnelClassLabel(p.personnel_class)}) is outside configured eligibility.`);
  }
  const instr = await db.query('SELECT 1 FROM duty_instructions WHERE assignment_id = $1', [assignmentId]);
  if (!instr.rowCount) w.push('No duty instructions published yet.');
  if (a.accept_required && people.some((p) => p.status === 'ASSIGNED') && a.status !== 'DRAFT')
    w.push('Waiting for acceptance by one or more assigned personnel.');
  return w;
}

/** Called by ingestion when a device reports DUTY_SESSION_STARTED for a per-person session. */
export async function onDeviceDutyStarted(
  c: pg.PoolClient,
  bus: EventBus | null,
  sessionId: string,
): Promise<void> {
  const p = (
    await c.query<{ assignment_id: string; status: string }>(
      `SELECT p.assignment_id, a.status FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
        WHERE p.duty_session_id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!p || !['ASSIGNED', 'ACCEPTED'].includes(p.status)) return;
  await transition(c, bus, { id: null, role: 'SYSTEM' }, p.assignment_id, {
    to: 'IN_PROGRESS',
    reason: 'Device reported duty start (device-reported time; not proof of physical attendance).',
  });
}

export async function notifyAssignmentSupervisors(
  c: pg.PoolClient,
  bus: EventBus | null,
  assignmentId: string,
  title: string,
  body: string,
  dedupeKey: string,
): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    `SELECT u.id FROM duty_assignments a JOIN app_users u ON u.id = a.created_by WHERE a.id = $1 AND u.is_active
     UNION SELECT u.id FROM duty_assignments a JOIN app_users u ON u.officer_id = a.supervisor_officer_id WHERE a.id = $1 AND u.is_active`,
    [assignmentId],
  );
  await notifyUsers(
    c,
    bus,
    rows.map((r) => r.id),
    { kind: 'EXCEPTION', title, body, relatedType: 'duty_assignment', relatedId: assignmentId, dedupeKey },
  );
}
