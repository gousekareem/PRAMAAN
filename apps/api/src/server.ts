import { createApp } from './app.js';
import { createContext } from './bootstrap.js';
import { migrate } from './database/migrate.js';
import { logger } from './logger.js';
import { evaluateDutyExceptions } from './services/exceptions.js';

const ctx = createContext();
if (ctx.env.RUN_MIGRATIONS_ON_START) {
  const r = await migrate(ctx.pool);
  logger.info({ applied: r.applied }, 'migrations checked');
}
const app = createApp(ctx);
const server = app.listen(ctx.env.PORT, ctx.env.HOST, () => {
  logger.info({ port: ctx.env.PORT, env: ctx.env.NODE_ENV }, 'PRAMAAN API listening');
});
if (ctx.env.demoLoginAllowed && ctx.env.NODE_ENV === 'production')
  logger.warn('ALLOW_DEMO_LOGIN=true in production: synthetic demo accounts can sign in (explicit configuration decision).');

// Periodic, idempotent evaluation of duty exceptions (reporting delays, overdue duties, sync silence).
let evaluator: NodeJS.Timeout | null = null;
if (ctx.env.EXCEPTION_EVALUATOR_INTERVAL_SECONDS > 0) {
  evaluator = setInterval(() => {
    evaluateDutyExceptions(ctx.pool, ctx.bus)
      .then((r) => {
        if (r.reportingDelayed || r.overdue || r.syncFailures) logger.info(r, 'duty exceptions raised');
      })
      .catch((e: Error) => logger.warn({ err: e.message }, 'exception evaluation failed'));
  }, ctx.env.EXCEPTION_EVALUATOR_INTERVAL_SECONDS * 1000);
  evaluator.unref();
}
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');
  if (evaluator) clearInterval(evaluator);
  const force = setTimeout(() => process.exit(1), 20_000);
  force.unref();
  server.close(async () => {
    await ctx.pool.end().catch(() => undefined);
    logger.info('shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (e) =>
  logger.error({ err: (e as Error)?.message }, 'unhandled rejection'),
);
