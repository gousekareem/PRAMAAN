import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { hashPassword, passwordPolicyIssues } from '../security/passwords.js';
import { findMigrationsDir } from './migrate.js';
import { appendAudit } from '../services/audit.js';
import { seedOperationalDemo } from './demo-operations.js';

/** Deterministic identifiers for the SYNTHETIC demonstration dataset. */
export const DEMO = {
  users: {
    admin: '10000000-0000-4000-8000-000000000001',
    supervisor: '10000000-0000-4000-8000-000000000002',
    reviewer: '10000000-0000-4000-8000-000000000003',
    officer1: '10000000-0000-4000-8000-000000000011',
    officer2: '10000000-0000-4000-8000-000000000012',
  },
  officers: {
    o1: '20000000-0000-4000-8000-000000000001',
    o2: '20000000-0000-4000-8000-000000000002',
  },
  zones: {
    pf1: 'a0000000-0000-4000-8000-000000000001',
    concourse: 'a0000000-0000-4000-8000-000000000002',
    yard: 'a0000000-0000-4000-8000-000000000003',
    section: 'a0000000-0000-4000-8000-000000000004',
  },
  duties: {
    d1: '30000000-0000-4000-8000-000000000001',
    d2: '30000000-0000-4000-8000-000000000002',
  },
  emails: {
    admin: 'admin@pramaan.demo',
    supervisor: 'supervisor@pramaan.demo',
    reviewer: 'reviewer@pramaan.demo',
    officer1: 'officer1@pramaan.demo',
    officer2: 'officer2@pramaan.demo',
  },
} as const;

const PRAMAAN_TABLES = [
  'notifications',
  'record_corrections',
  'review_flag_notes',
  'duty_instruction_acks',
  'duty_instructions',
  'duty_handovers',
  'duty_assignment_changes',
  'duty_assignment_personnel',
  'personnel_unavailability',
  'duty_assignments',
  'duty_category_eligibility',
  'duty_categories',
  'role_permissions',
  'permissions',
  'roles',
  'units',
  'audit_events',
  'audit_chain_head',
  'review_flags',
  'checkins',
  'evidence_objects',
  'patrol_logs',
  'ingestion_conflicts',
  'ingestion_rejections',
  'device_events',
  'sync_batches',
  'duty_zone_assignments',
  'duty_sessions',
  'geo_zones',
  'device_chain_heads',
  'devices',
  'refresh_tokens',
  'app_users',
  'officers',
  'retention_policies',
  'schema_migrations',
];

/** Drops all PRAMAAN tables (demo reset). Refuses unless explicitly allowed. Never use on real data. */
export async function dropAllPramaanTables(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS ${PRAMAAN_TABLES.join(', ')} CASCADE`);
}

export async function seedDemo(
  pool: pg.Pool,
  password: string,
  now = new Date(),
  referenceDate: Date = now,
): Promise<void> {
  const issues = passwordPolicyIssues(password);
  if (issues.length) throw new Error(`SEED_DEMO_PASSWORD must contain ${issues.join(', ')}`);
  const pw = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const zonesSql = readFileSync(
      join(findMigrationsDir(), '..', 'seeds', '0001_demo_zones.sql'),
      'utf8',
    );
    await client.query(zonesSql);
    await client.query(
      `INSERT INTO officers (id, employee_ref, display_name, rank, station, is_demo) VALUES
        ($1, 'DEMO-PC-001', 'DEMO Constable A. Kumar', 'PC', 'DEMO Guntur GRP (fictional)', true),
        ($2, 'DEMO-HC-002', 'DEMO Head Constable S. Reddy', 'HC', 'DEMO Guntur GRP (fictional)', true)
       ON CONFLICT (id) DO NOTHING`,
      [DEMO.officers.o1, DEMO.officers.o2],
    );
    const users: [string, string, string, string, string | null][] = [
      [DEMO.users.admin, DEMO.emails.admin, 'DEMO System Administrator', 'ADMIN', null],
      [DEMO.users.supervisor, DEMO.emails.supervisor, 'DEMO DSP (Supervisor)', 'SUPERVISOR', null],
      [DEMO.users.reviewer, DEMO.emails.reviewer, 'DEMO Read-only Reviewer', 'REVIEWER', null],
      [
        DEMO.users.officer1,
        DEMO.emails.officer1,
        'DEMO Constable A. Kumar',
        'OFFICER',
        DEMO.officers.o1,
      ],
      [
        DEMO.users.officer2,
        DEMO.emails.officer2,
        'DEMO Head Constable S. Reddy',
        'OFFICER',
        DEMO.officers.o2,
      ],
    ];
    for (const [id, email, name, role, officer] of users) {
      await client.query(
        `INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id, is_demo) VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, failed_login_count = 0, locked_until = NULL`,
        [id, email, name, role, pw, officer],
      );
    }
    const start = new Date(now.getTime() - 60 * 60_000);
    const end = new Date(now.getTime() + 7 * 3600_000);
    await client.query(
      `INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, assignment_notes, authorized_by, is_demo) VALUES
        ($1,$2,$3,$4,'DEMO: Platform 1 and concourse patrol (synthetic)', $6, true),
        ($5,$7,$3,$4,'DEMO: Yard patrol (synthetic)', $6, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        DEMO.duties.d1,
        DEMO.officers.o1,
        start,
        end,
        DEMO.duties.d2,
        DEMO.users.supervisor,
        DEMO.officers.o2,
      ],
    );
    await client.query(
      `INSERT INTO duty_zone_assignments VALUES ($1,$2),($1,$3),($4,$5) ON CONFLICT DO NOTHING`,
      [DEMO.duties.d1, DEMO.zones.pf1, DEMO.zones.concourse, DEMO.duties.d2, DEMO.zones.yard],
    );
    await seedOperationalDemo(client, referenceDate, [DEMO.officers.o1, DEMO.officers.o2]);
    await appendAudit(client, {
      actorUserId: null,
      actorRole: 'SYSTEM',
      action: 'DEMO_DATA_SEEDED',
      targetType: 'database',
      details: { synthetic: true },
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
