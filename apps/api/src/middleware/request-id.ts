import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Accepts a well-formed client X-Request-Id for correlation, otherwise generates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (req as { id?: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export function reqId(req: unknown): string {
  return (req as { id?: string }).id ?? 'unknown';
}
