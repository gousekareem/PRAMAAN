import { all, type SqlDatabase } from '../storage/db';

export interface RetentionPolicy {
  /** Acknowledged events older than this are compacted into ledger_archive. */
  compactAfterDays: number;
  /** Sealed evidence files are removed only after server VERIFIED and this many days. */
  evidenceFileRetentionDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  compactAfterDays: 14,
  evidenceFileRetentionDays: 7,
};

/**
 * Bounded local storage. Rows are compacted ONLY when: the server acknowledged the event,
 * any evidence it references was VERIFIED by the server, it is older than the policy window,
 * and its sequence is at or below the last server-acknowledged chain head.
 * The archive keeps (sequence, hash, previous hash) so the local chain remains verifiable.
 * Unsynchronised or rejected events are never removed.
 */
export async function compactLedger(
  db: SqlDatabase,
  deleteFile: (path: string) => Promise<void>,
  now = new Date(),
  p: RetentionPolicy = DEFAULT_RETENTION,
) {
  const headRow = (
    await db.execute("SELECT value_json FROM sync_cursors WHERE name = 'server_chain_head'")
  ).rows[0];
  const headSeq = headRow
    ? Number((JSON.parse(String(headRow.value_json)) as { sequence: number }).sequence)
    : 0;
  const cutoff = new Date(now.getTime() - p.compactAfterDays * 86_400_000).toISOString();
  const evCutoff = new Date(now.getTime() - p.evidenceFileRetentionDays * 86_400_000).toISOString();
  const files = await all(
    db,
    "SELECT evidence_id, sealed_path FROM evidence_manifests WHERE upload_state = 'VERIFIED' AND local_file_deleted = 0 AND created_at < ?",
    [evCutoff],
  );
  for (const f of files) {
    await deleteFile(String(f.sealed_path));
    await db.execute('UPDATE evidence_manifests SET local_file_deleted = 1 WHERE evidence_id = ?', [
      String(f.evidence_id),
    ]);
  }
  const candidates = await all(
    db,
    `SELECT l.event_id FROM ledger_events l JOIN sync_outbox o ON o.event_id = l.event_id
     LEFT JOIN evidence_manifests e ON e.event_id = l.event_id
     WHERE o.state = 'ACKNOWLEDGED' AND l.created_at < ? AND l.device_sequence_number <= ?
       AND (e.evidence_id IS NULL OR (e.upload_state = 'VERIFIED' AND e.local_file_deleted = 1))
       AND l.device_sequence_number < (SELECT max(device_sequence_number) FROM ledger_events)
     ORDER BY l.device_sequence_number`,
    [cutoff, headSeq],
  );
  let compacted = 0;
  await db.transaction(async (tx) => {
    for (const c of candidates) {
      const id = String(c.event_id);
      await tx.execute(
        `INSERT INTO ledger_archive (event_id, device_sequence_number, event_type, event_hash, previous_event_hash, acknowledged_at, compacted_at)
        SELECT l.event_id, l.device_sequence_number, l.event_type, l.event_hash, l.previous_event_hash, o.acknowledged_at, ? FROM ledger_events l JOIN sync_outbox o ON o.event_id = l.event_id WHERE l.event_id = ?`,
        [now.toISOString(), id],
      );
      await tx.execute('DELETE FROM checkin_results WHERE event_id = ?', [id]);
      await tx.execute('DELETE FROM sensor_milestones WHERE event_id = ?', [id]);
      await tx.execute('DELETE FROM evidence_manifests WHERE event_id = ?', [id]);
      await tx.execute('DELETE FROM sync_outbox WHERE event_id = ?', [id]);
      await tx.execute('DELETE FROM ledger_events WHERE event_id = ?', [id]);
      compacted++;
    }
  });
  return { compacted, evidenceFilesRemoved: files.length };
}
