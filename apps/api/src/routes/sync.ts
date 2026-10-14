import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppContext } from '../context.js';
import { authUser, h, requireRole } from '../middleware/auth.js';
import { reqId } from '../middleware/request-id.js';
import { ingestBatch } from '../ingestion/ingest.js';
import { handleEvidenceUpload } from '../evidence/upload.js';
import { param } from './common.js';

export function syncRoutes(ctx: AppContext): Router {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: ctx.env.RATE_LIMIT_SYNC_PER_MIN,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      res
        .status(429)
        .setHeader('Retry-After', '60')
        .json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many sync requests.',
            requestId: reqId(req),
          },
        }),
  });
  r.post(
    '/batch',
    limiter,
    requireRole('OFFICER'),
    h(async (req, res) => {
      const out = await ingestBatch(ctx, authUser(req), req.body, reqId(req));
      res.status(out.status).json(out.body);
    }),
  );
  r.put(
    '/evidence/:evidenceId',
    limiter,
    requireRole('OFFICER'),
    h(async (req, res) => {
      const out = await handleEvidenceUpload(
        ctx,
        req,
        authUser(req),
        param(req, 'evidenceId'),
        reqId(req),
      );
      res.status(out.status).json(out.body);
    }),
  );
  return r;
}
