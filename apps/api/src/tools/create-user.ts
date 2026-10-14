/**
 * Creates a real (non-demo) user. Password is taken from PRAMAAN_NEW_PASSWORD (never a CLI argument).
 * Usage: node dist/tools/create-user.js --email a@b --name "Name" --role ADMIN|SUPERVISOR|REVIEWER|OFFICER
 *        [--officer-ref GRP-PC-0001 --rank CONSTABLE --station "Guntur"]   (OFFICER only)
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadDatabaseEnv } from '../config/env.js';
import { createPool, withTransaction } from '../database/pool.js';
import { hashPassword, passwordPolicyIssues } from '../security/passwords.js';
import { appendAudit } from '../services/audit.js';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const input = z
  .object({
    email: z
      .string()
      .email()
      .transform((s) => s.toLowerCase()),
    name: z.string().min(2).max(80),
    role: z.enum(['ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER']),
    officerRef: z
      .string()
      .regex(/^[A-Z0-9-]{3,32}$/)
      .optional(),
    rank: z
      .enum(['CONSTABLE', 'HEAD_CONSTABLE', 'ASI', 'SI', 'INSPECTOR', 'DSP', 'OTHER'])
      .optional(),
    station: z.string().min(2).max(80).optional(),
  })
  .parse({
    email: arg('email'),
    name: arg('name'),
    role: arg('role'),
    officerRef: arg('officer-ref'),
    rank: arg('rank'),
    station: arg('station'),
  });

const password = process.env.PRAMAAN_NEW_PASSWORD ?? '';
const issues = passwordPolicyIssues(password);
if (issues.length) {
  console.error(`PRAMAAN_NEW_PASSWORD must contain ${issues.join(', ')}`);
  process.exit(2);
}
if (input.role === 'OFFICER' && (!input.officerRef || !input.rank || !input.station)) {
  console.error('OFFICER requires --officer-ref, --rank and --station');
  process.exit(2);
}
const env = loadDatabaseEnv();
const pool = createPool(env);
try {
  const hash = await hashPassword(password);
  const id = randomUUID();
  await withTransaction(pool, async (c) => {
    let officerId: string | null = null;
    if (input.role === 'OFFICER') {
      officerId = randomUUID();
      await c.query(
        'INSERT INTO officers (id, employee_ref, display_name, rank, station) VALUES ($1,$2,$3,$4,$5)',
        [officerId, input.officerRef, input.name, input.rank, input.station],
      );
    }
    await c.query(
      'INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, input.email, input.name, input.role, hash, officerId],
    );
    await appendAudit(c, {
      actorUserId: null,
      actorRole: 'OPERATOR_CLI',
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: id,
      details: { role: input.role, email: input.email },
    });
  });
  console.log(`Created ${input.role} ${input.email} (${id})`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
