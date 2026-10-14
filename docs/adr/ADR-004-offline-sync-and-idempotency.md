# ADR-004 — Append-only ledger, persistent outbox and idempotent batch ingestion

**Status:** Accepted

## Decision
- Device: every append is one SQLCipher transaction (ledger row + outbox row + head update).
- Outbox rows are assigned to a `batchId` and keep it until the server answers, so a retry after a
  timeout, crash or lost response is a byte-identical replay.
- Server: `batchId` is an idempotency key (identical replay → stored response; different content →
  409). Event IDs and `(deviceId, sequence)` are unique. Per-event results are returned
  (`ACCEPTED | DUPLICATE | REJECTED | CONFLICT`); all of them are committed atomically with the
  batch, while any unexpected server error rolls back the entire batch.
- Conflicting duplicates are preserved in `ingestion_conflicts`; rejected submissions are preserved
  in `ingestion_rejections`. No last-write-wins.
- Gaps are accepted with `chain_link_status = GAP_BEFORE` and a review flag; a later "late fill" is
  verified against both neighbours. Gaps are never silently repaired.
- The device never deletes an event because an HTTP call succeeded; compaction is a separate,
  retention-driven step that keeps (sequence, hash, previous hash) in `ledger_archive`.
