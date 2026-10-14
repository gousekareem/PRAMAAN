import { z } from 'zod';
import type { Request } from 'express';
import { AppError } from '../middleware/errors.js';
import type { AuthUser } from '../middleware/auth.js';

export const uuidParam = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .transform((s) => s.toLowerCase());

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paging(q: { page: number; pageSize: number }) {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

export function pageResult<T>(items: T[], total: number, q: { page: number; pageSize: number }) {
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export function param(req: Request, name: string): string {
  const r = uuidParam.safeParse(req.params[name]);
  if (!r.success)
    throw new AppError(400, 'VALIDATION_FAILED', `Path parameter '${name}' must be a UUID.`);
  return r.data;
}

export const isoQuery = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO timestamp');

/** Object-level authorisation: officers may only access their own records. */
export function assertOfficerScope(user: AuthUser, officerId: string): void {
  if (user.role === 'OFFICER' && user.officerId !== officerId)
    throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
}

/** Classifies observation freshness so stale data is never presented as live. */
export function freshness(recordedAt: Date, receivedAt: Date, now = new Date()) {
  const ageMs = now.getTime() - recordedAt.getTime();
  const syncDelayMs = receivedAt.getTime() - recordedAt.getTime();
  let label: 'RECENTLY_RECEIVED' | 'DELAYED_SYNC' | 'OFFLINE_LAST_KNOWN' | 'STALE';
  if (ageMs <= 10 * 60_000) label = syncDelayMs > 5 * 60_000 ? 'DELAYED_SYNC' : 'RECENTLY_RECEIVED';
  else if (syncDelayMs > 15 * 60_000) label = 'DELAYED_SYNC';
  else if (ageMs <= 60 * 60_000) label = 'OFFLINE_LAST_KNOWN';
  else label = 'STALE';
  return { label, ageMs, syncDelayMs };
}
