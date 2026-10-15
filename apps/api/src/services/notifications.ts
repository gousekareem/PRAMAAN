import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { EventBus } from '../events/bus.js';

export type NotificationKind =
  | 'ASSIGNMENT'
  | 'ASSIGNMENT_CHANGED'
  | 'INSTRUCTIONS'
  | 'EXCEPTION'
  | 'HANDOVER'
  | 'CORRECTION';

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  relatedType?: string;
  relatedId?: string;
  dedupeKey?: string;
}

/**
 * Queues in-app notifications. The status starts QUEUED and only becomes DELIVERED when the
 * recipient's signed-in client retrieves it (GET /api/v1/notifications). Nothing is pushed.
 */
export async function notifyUsers(
  c: pg.PoolClient,
  bus: EventBus | null,
  userIds: string[],
  n: NotificationInput,
): Promise<number> {
  let created = 0;
  for (const uid of new Set(userIds)) {
    const r = await c.query(
      `INSERT INTO notifications (id, recipient_user_id, kind, title, body, related_type, related_id, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        randomUUID(),
        uid,
        n.kind,
        n.title,
        n.body,
        n.relatedType ?? null,
        n.relatedId ?? null,
        n.dedupeKey ? `${n.dedupeKey}:${uid}` : null,
      ],
    );
    if (r.rowCount) {
      created++;
      if (bus)
        setImmediate(() =>
          bus.publish({ type: 'notification', recipientUserId: uid, at: new Date().toISOString() }),
        );
    }
  }
  return created;
}

/** Notifies the active login accounts linked to the given personnel records. */
export async function notifyOfficers(
  c: pg.PoolClient,
  bus: EventBus | null,
  officerIds: string[],
  n: NotificationInput,
): Promise<number> {
  if (!officerIds.length) return 0;
  const { rows } = await c.query<{ id: string }>(
    'SELECT id FROM app_users WHERE officer_id = ANY($1::uuid[]) AND is_active',
    [officerIds],
  );
  return notifyUsers(
    c,
    bus,
    rows.map((r) => r.id),
    n,
  );
}
