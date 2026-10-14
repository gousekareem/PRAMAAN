import { loadDatabaseEnv } from '../config/env.js';
import { createPool } from '../database/pool.js';
import { verifyFullAuditChain } from '../services/audit.js';

const pool = createPool(loadDatabaseEnv());
try {
  const r = await verifyFullAuditChain(pool);
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await pool.end();
}
