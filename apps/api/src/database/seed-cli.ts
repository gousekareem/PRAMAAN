import { loadEnv } from '../config/env.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';
import { dropAllPramaanTables, seedDemo, DEMO } from './seed.js';

/**
 * Usage: pnpm db:seed            -> migrate + insert synthetic demo data
 *        pnpm db:seed -- --reset -> DROP all PRAMAAN tables, migrate, seed (demo reset)
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
  await seedDemo(pool, env.SEED_DEMO_PASSWORD);
  console.log('Synthetic demo data seeded. Accounts:', Object.values(DEMO.emails).join(', '));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
