export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 30 * 60_000 };

/** Bounded exponential backoff with "equal jitter": delay ∈ [d/2, d], d = min(max, base·2^attempt). */
export function backoffDelay(
  attempt: number,
  random01: () => number,
  p: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  const exp = Math.min(p.maxMs, p.baseMs * 2 ** Math.min(30, Math.max(0, attempt)));
  return Math.round(exp / 2 + random01() * (exp / 2));
}
