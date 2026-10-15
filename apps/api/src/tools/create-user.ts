/**
 * Creates a real (non-demo) login account. Password is taken from PRAMAAN_NEW_PASSWORD (never a CLI argument).
 * Role codes come from the `roles` table (HG, PC, HC, ASI, SI, CI, DSP, ADMIN, …).
 *
 * Usage:
 *   node dist/tools/create-user.js --email a@b --name "Name" --role ADMIN
 *   node dist/tools/create-user.js --email a@b --name "Name" --role SI --personnel-ref GRP-SI-0001
 *   node dist/tools/create-user.js --email a@b --name "Name" --role PC --personnel-ref GRP-PC-0002 \
 *        --create-personnel --rank PC --constable-category AR --unit-code ST-01
 *   (Home Guard: --create-personnel --personnel-category HOME_GUARD --unit-code ST-01)
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
    email: z.string().email().transform((s) => s.toLowerCase()),
    name: z.string().min(2).max(80),
    role: z.string().regex(/^[A-Z_]{2,32}$/),
    personnelRef: z.string().regex(/^[A-Z0-9-]{3,32}$/).optional(),
    createPersonnel: z.boolean(),
    personnelCategory: z.enum(['POLICE', 'HOME_GUARD']).default('POLICE'),
    rank: z.enum(['PC', 'HC', 'ASI', 'SI', 'CI', 'DSP', 'OTHER']).optional(),
    constableCategory: z.enum(['AR', 'GENERAL']).optional(),
    unitCode: z.string().regex(/^[A-Z0-9-]{2,32}$/).optional(),
  })
  .parse({
    email: arg('email'),
    name: arg('name'),
    role: arg('role'),
    personnelRef: arg('personnel-ref'),
    createPersonnel: process.argv.includes('--create-personnel'),
    personnelCategory: arg('personnel-category'),
    rank: arg('rank'),
    constableCategory: arg('constable-category'),
    unitCode: arg('unit-code'),
  });

const password = process.env.PRAMAAN_NEW_PASSWORD ?? '';
const issues = passwordPolicyIssues(password);
if (issues.length) {
  console.error(`PRAMAAN_NEW_PASSWORD must contain ${issues.join(', ')}`);
  process.exit(2);
}
const pool = createPool(loadDatabaseEnv());
try {
  const hash = await hashPassword(password);
  const id = randomUUID();
  await withTransaction(pool, async (c) => {
    const role = (await c.query<{ requires_personnel: boolean }>('SELECT requires_personnel FROM roles WHERE code = $1', [input.role])).rows[0];
    if (!role) throw new Error(`Unknown role ${input.role}`);
    let officerId: string | null = null;
    if (input.personnelRef) {
      if (input.createPersonnel) {
        if (!input.unitCode) throw new Error('--create-personnel needs --unit-code');
        if (input.personnelCategory === 'POLICE' && !input.rank) throw new Error('Police personnel need --rank');
        const unit = (await c.query<{ id: string; name: string }>('SELECT id, name FROM units WHERE code = $1', [input.unitCode])).rows[0];
        if (!unit) throw new Error(`Unknown unit ${input.unitCode}`);
        officerId = randomUUID();
        await c.query(
          `INSERT INTO officers (id, employee_ref, display_name, rank, station, personnel_category, constable_category, unit_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            officerId,
            input.personnelRef,
            input.name,
            input.personnelCategory === 'HOME_GUARD' ? null : input.rank,
            unit.name.slice(0, 80),
            input.personnelCategory,
            input.rank === 'PC' ? (input.constableCategory ?? null) : null,
            unit.id,
          ],
        );
      } else {
        officerId = (await c.query<{ id: string }>('SELECT id FROM officers WHERE employee_ref = $1 AND is_active', [input.personnelRef])).rows[0]?.id ?? null;
        if (!officerId) throw new Error(`No active personnel record ${input.personnelRef}`);
      }
    }
    if (role.requires_personnel && !officerId) throw new Error(`Role ${input.role} requires --personnel-ref`);
    await c.query(
      'INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, input.email, input.name, input.role, hash, officerId],
    );
    await appendAudit(c, {
      actorUserId: null,
      actorRole: 'OPERATOR_CLI',
      action: 'ACCOUNT_CREATED',
      targetType: 'user',
      targetId: id,
      details: { role: input.role, email: input.email, officerId },
    });
  });
  console.log(`Created ${input.role} ${input.email} (${id})`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
