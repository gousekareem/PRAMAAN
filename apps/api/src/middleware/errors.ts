import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'DEVICE_NOT_REGISTERED'
  | 'DEVICE_NOT_APPROVED'
  | 'DEVICE_REVOKED'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'EVIDENCE_HASH_MISMATCH'
  | 'EVIDENCE_INVALID'
  | 'EVIDENCE_TOO_LARGE'
  | 'EVIDENCE_EVENT_NOT_FOUND'
  | 'EVIDENCE_UPLOAD_LIMIT'
  | 'STORED_EVIDENCE_INTEGRITY_FAILURE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Resource not found.'));
};

/** Consistent error envelope. Never leaks stack traces, SQL or secrets. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = (req as { id?: string }).id ?? 'unknown';
  let status = 500;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';
  let details: unknown;
  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_FAILED';
    message = 'The request failed validation.';
    details = err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION_FAILED';
    message = 'The request body is not valid JSON.';
  } else if (
    typeof err?.code === 'string' &&
    ['ECONNREFUSED', '57P01', '57P03', '53300', 'ETIMEDOUT'].includes(err.code)
  ) {
    status = 503;
    code = 'DATABASE_UNAVAILABLE';
    message = 'The database is temporarily unavailable. Retry later.';
  }
  if (status >= 500)
    logger.error(
      { requestId, err: { message: err?.message, code: err?.code, stack: err?.stack } },
      'request failed',
    );
  else logger.info({ requestId, code, status }, 'request rejected');
  if (status === 503) res.setHeader('Retry-After', '30');
  res.status(status).json({ error: { code, message, requestId, ...(details ? { details } : {}) } });
};
