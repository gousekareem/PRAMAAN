import type pg from 'pg';
import type { AuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';

/**
 * Data-scope helpers. Every list/detail query that returns personnel-linked data passes through
 * one of these so that a user only sees records inside the scope configured for their role:
 *   SELF       – only the user's own personnel record
 *   UNIT       – personnel of the user's unit
 *   UNIT_TREE  – personnel of the user's unit and all descendant units
 *   ALL        – no unit restriction (administrator / legacy roles)
 */
export function officerScopeSql(u: AuthUser, column: string, args: unknown[]): string {
  if (u.scope.level === 'ALL') return 'TRUE';
  if (u.scope.level === 'SELF') {
    if (!u.officerId) return 'FALSE';
    args.push(u.officerId);
    return `${column} = $${args.length}::uuid`;
  }
  args.push(u.scope.unitIds ?? []);
  return `${column} IN (SELECT so.id FROM officers so WHERE so.unit_id = ANY($${args.length}::uuid[]))`;
}

/** Units visible to the user (null = all). */
export function unitScopeSql(u: AuthUser, column: string, args: unknown[]): string {
  if (u.scope.level === 'ALL') return 'TRUE';
  if (u.scope.level === 'SELF') return 'FALSE';
  args.push(u.scope.unitIds ?? []);
  return `${column} = ANY($${args.length}::uuid[])`;
}

/**
 * Duty assignments visible to the user: assignments owned by a unit in scope, or with any
 * (current or former) assigned person in scope. SELF users see only duties they were assigned to.
 */
export function assignmentScopeSql(u: AuthUser, alias: string, args: unknown[]): string {
  if (u.scope.level === 'ALL') return 'TRUE';
  const person = officerScopeSql(u, 'sp.officer_id', args);
  const viaPerson = `EXISTS (SELECT 1 FROM duty_assignment_personnel sp WHERE sp.assignment_id = ${alias}.id AND ${person})`;
  if (u.scope.level === 'SELF') return viaPerson;
  return `(${unitScopeSql(u, `${alias}.unit_id`, args)} OR ${viaPerson})`;
}

export async function officerInScope(
  db: pg.Pool | pg.PoolClient,
  u: AuthUser,
  officerId: string,
): Promise<boolean> {
  if (u.scope.level === 'ALL') return true;
  if (u.scope.level === 'SELF') return u.officerId === officerId;
  const { rowCount } = await db.query(
    'SELECT 1 FROM officers WHERE id = $1 AND unit_id = ANY($2::uuid[])',
    [officerId, u.scope.unitIds ?? []],
  );
  return !!rowCount;
}

/** Object-level authorisation: out-of-scope records are reported as "not found". */
export async function assertOfficerInScope(
  db: pg.Pool | pg.PoolClient,
  u: AuthUser,
  officerId: string,
): Promise<void> {
  if (!(await officerInScope(db, u, officerId)))
    throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
}

export async function assignmentInScope(
  db: pg.Pool | pg.PoolClient,
  u: AuthUser,
  assignmentId: string,
): Promise<boolean> {
  const args: unknown[] = [assignmentId];
  const cond = assignmentScopeSql(u, 'a', args);
  const { rowCount } = await db.query(
    `SELECT 1 FROM duty_assignments a WHERE a.id = $1 AND ${cond}`,
    args,
  );
  return !!rowCount;
}

/**
 * Restricted duty details (VIP escort, track incident) are visible to holders of
 * duty.view_restricted and to personnel actually assigned to that duty.
 */
export async function canSeeRestrictedDetails(
  db: pg.Pool | pg.PoolClient,
  u: AuthUser,
  assignmentId: string,
): Promise<boolean> {
  if (u.permissions.has('duty.view_restricted')) return true;
  if (!u.officerId) return false;
  const { rowCount } = await db.query(
    'SELECT 1 FROM duty_assignment_personnel WHERE assignment_id = $1 AND officer_id = $2',
    [assignmentId, u.officerId],
  );
  return !!rowCount;
}

/** Restricted category of the duty an evidence object / session belongs to (null if none). */
export async function restrictedAssignmentForSession(
  db: pg.Pool | pg.PoolClient,
  dutySessionId: string | null,
): Promise<string | null> {
  if (!dutySessionId) return null;
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
       JOIN duty_categories c ON c.code = a.category
      WHERE p.duty_session_id = $1 AND c.is_restricted`,
    [dutySessionId],
  );
  return rows[0]?.id ?? null;
}

/**
 * SQL filter hiding records linked to a restricted duty (VIP escort / track incident) unless the
 * user holds duty.view_restricted or the record belongs to the user themself.
 */
export function restrictedSessionFilterSql(
  u: AuthUser,
  sessionColumn: string,
  officerColumn: string,
  args: unknown[],
): string {
  if (u.permissions.has('duty.view_restricted')) return 'TRUE';
  args.push(u.officerId);
  return `(${officerColumn} = $${args.length}::uuid OR ${sessionColumn} IS NULL OR NOT EXISTS (
    SELECT 1 FROM duty_assignment_personnel rp JOIN duty_assignments ra ON ra.id = rp.assignment_id
      JOIN duty_categories rc ON rc.code = ra.category
     WHERE rp.duty_session_id = ${sessionColumn} AND rc.is_restricted))`;
}

/** SQL visibility of a review flag (alias f) for the user. */
export function flagScopeSql(u: AuthUser, args: unknown[]): string {
  if (u.scope.level === 'ALL') return restrictedSessionFilterSql(u, 'f.duty_session_id', 'f.officer_id', args);
  const off = officerScopeSql(u, 'f.officer_id', args);
  const asg = assignmentScopeSql(u, 'fx', args);
  return `((f.officer_id IS NOT NULL AND ${off}) OR (f.duty_assignment_id IS NOT NULL AND EXISTS (SELECT 1 FROM duty_assignments fx WHERE fx.id = f.duty_assignment_id AND ${asg})))
    AND ${restrictedSessionFilterSql(u, 'f.duty_session_id', 'f.officer_id', args)}`;
}

