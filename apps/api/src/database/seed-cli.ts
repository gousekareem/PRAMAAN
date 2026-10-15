import { loadEnv } from '../config/env.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';
import { dropAllPramaanTables, seedDemo, DEMO } from './seed.js';
import { DEMO_ACCOUNTS, istMidnight } from './demo-operations.js';

/**
 * Usage: pnpm db:seed                                   -> migrate + insert synthetic demo data
 *        pnpm db:seed -- --reset                        -> DROP all PRAMAAN tables, migrate, seed (demo reset)
 *        pnpm db:seed -- --reset --reference-date 2026-10-15  -> reproducible dataset anchored to that IST date
 * Requires ALLOW_DEMO_SEED=true and SEED_DEMO_PASSWORD; refused when NODE_ENV=production.
 */
const env = loadEnv();
if (env.NODE_ENV === 'production' || !env.ALLOW_DEMO_SEED) {
  console.error('Refusing to seed: set ALLOW_DEMO_SEED=true in a non-production environment.');
  process.exit(1);
}
if (!env.SEED_DEMO_PASSWORD) {
  console.error(
    'SEED_DEMO_PASSWORD is required (development-only password for the demo accounts).',
  );
  process.exit(1);
}
const pool = createPool(env);
try {
  if (process.argv.includes('--reset')) {
    await dropAllPramaanTables(pool);
    console.log('Demo reset: all PRAMAAN tables dropped.');
  }
  await migrate(pool);
  const i = process.argv.indexOf('--reference-date');
  const ref = i > 0 ? new Date(`${process.argv[i + 1]}T12:00:00+05:30`) : new Date();
  if (Number.isNaN(ref.getTime())) throw new Error('--reference-date must be YYYY-MM-DD');
  await seedDemo(pool, env.SEED_DEMO_PASSWORD, new Date(), ref);
  console.log(
    'DEMO DATA seeded (synthetic). Reference date (IST):',
    new Date(istMidnight(ref).getTime() + 330 * 60_000).toISOString().slice(0, 10),
  );
  console.log('Rank accounts (local demo only):');
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.email.padEnd(22)} ${a.password}`);
  console.log('Legacy PRAMAAN 1.0 accounts (password = SEED_DEMO_PASSWORD):', Object.values(DEMO.emails).join(', '));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
