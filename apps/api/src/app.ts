import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context.js';
import { logger } from './logger.js';
import { requestId, reqId } from './middleware/request-id.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requireAuth } from './middleware/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { officerRoutes } from './routes/officers.js';
import { deviceRoutes } from './routes/devices.js';
import { dutyRoutes } from './routes/duties.js';
import { zoneRoutes } from './routes/zones.js';
import { patrolLogRoutes } from './routes/patrol-logs.js';
import { syncRoutes } from './routes/sync.js';
import { evidenceRoutes } from './routes/evidence.js';
import { alertRoutes, dashboardRoutes } from './routes/dashboard.js';
import { auditRoutes } from './routes/audit.js';
import { userRoutes } from './routes/users.js';
import { dutyAssignmentRoutes } from './routes/duty-assignments.js';
import { personnelRoutes } from './routes/personnel.js';
import { accountRoutes, policyRoutes, systemRoutes, unitRoutes } from './routes/administration.js';
import { checkinRoutes, correctionRoutes, rosterRoutes } from './routes/presence.js';
import { exceptionRoutes, meRoutes, notificationRoutes, operationsRoutes } from './routes/inbox.js';
import { reportRoutes } from './routes/reports.js';

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.env.TRUST_PROXY);
  app.use(requestId);
  if (ctx.env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => reqId(req),
        autoLogging: { ignore: (req) => req.url === '/health' },
      }),
    );
  }
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        ctx.env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || ctx.env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-PRAMAAN-CSRF'],
      exposedHeaders: [
        'X-Request-Id',
        'X-Package-SHA256',
        'X-Content-SHA256',
        'Content-Disposition',
      ],
      maxAge: 600,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: ctx.env.RATE_LIMIT_GENERAL_PER_MIN,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      handler: (req, res) =>
        res
          .status(429)
          .json({
            error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: reqId(req) },
          }),
    }),
  );
  app.use(
    express.json({ limit: ctx.env.MAX_JSON_BODY_BYTES, strict: true, type: 'application/json' }),
  );
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.setTimeout(120_000);
    res.setTimeout(120_000);
    next();
  });

  app.use(healthRoutes(ctx));
  app.use('/api/v1/auth', authRoutes(ctx));
  const auth = requireAuth(ctx);
  app.use('/api/v1/officers', auth, officerRoutes(ctx));
  app.use('/api/v1/devices', auth, deviceRoutes(ctx));
  app.use('/api/v1/duties', auth, dutyRoutes(ctx));
  app.use('/api/v1/zones', auth, zoneRoutes(ctx));
  app.use('/api/v1/patrol-logs', auth, patrolLogRoutes(ctx));
  app.use('/api/v1/sync', auth, syncRoutes(ctx));
  app.use('/api/v1/evidence', auth, evidenceRoutes(ctx));
  app.use('/api/v1/dashboard', auth, dashboardRoutes(ctx));
  app.use('/api/v1/alerts', auth, alertRoutes(ctx));
  app.use('/api/v1/audit-events', auth, auditRoutes(ctx));
  app.use('/api/v1/users', auth, userRoutes(ctx));
  // Railway-police operational modules (PRAMAAN 2.0)
  app.use('/api/v1/duty-assignments', auth, dutyAssignmentRoutes(ctx));
  app.use('/api/v1/personnel', auth, personnelRoutes(ctx));
  app.use('/api/v1/units', auth, unitRoutes(ctx));
  app.use('/api/v1/accounts', auth, accountRoutes(ctx));
  app.use('/api/v1/policy', auth, policyRoutes(ctx));
  app.use('/api/v1/system', auth, systemRoutes(ctx));
  app.use('/api/v1/roster', auth, rosterRoutes(ctx));
  app.use('/api/v1/checkins', auth, checkinRoutes(ctx));
  app.use('/api/v1/corrections', auth, correctionRoutes(ctx));
  app.use('/api/v1/notifications', auth, notificationRoutes(ctx));
  app.use('/api/v1/exceptions', auth, exceptionRoutes(ctx));
  app.use('/api/v1/dashboard', auth, operationsRoutes(ctx));
  app.use('/api/v1/me', auth, meRoutes(ctx));
  app.use('/api/v1/reports', auth, reportRoutes(ctx));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
