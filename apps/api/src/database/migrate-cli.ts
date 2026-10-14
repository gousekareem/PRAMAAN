import { loadDatabaseEnv } from '../config/env.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const env = loadDatabaseEnv();
const pool = createPool(env);
try {
  const r = await migrate(pool);
  console.log(
    JSON.stringify({ applied: r.applied, alreadyApplied: r.alreadyApplied.length }, null, 2),
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
