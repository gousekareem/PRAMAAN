# Operational procedures (prototype guidance)

These procedures describe how the prototype's controls are meant to be used. They are **not** departmental
standing orders. Before any real use, the department must adopt its own procedures with legal advice.

## 1. Privacy and data handling
* Collect only what a duty needs. Location sampling runs only during a started duty session, with a visible
  notification. VIP-escort and track-incident details stay restricted. Use synthetic labels in training and
  demonstrations.
* Never enter victim identities, real VIP itineraries, personal phone numbers or official case numbers into a
  demonstration system. In a real system, record the minimum needed and restrict it.
* Exceptions are prompts for review. Never take disciplinary action on the basis of a PRAMAAN exception alone;
  corroborate first and record investigation notes.

## 2. Evidence retention
* Defaults (configurable in `retention_policies`): evidence images 730 days, location observations 180 days,
  audit records 7 years, rejected submissions 365 days.
* Devices compact local events only after the server has acknowledged them, any referenced evidence is
  verified, and the age threshold has passed.
* Purging on the server is a manual, audited transaction (see `privacy-governance.md`). Evidence linked to
  an open exception or a correction must not be purged. Backups expire on their own schedule.

## 3. Account revocation (transfer, retirement, suspension, compromised password)
1. An administrator opens **Personnel** → the person → **Deactivate** and records a reason. This also
   deactivates the linked login account, revokes all its sessions, and raises an `INACTIVE_PERSONNEL_ASSIGNED`
   exception for each open duty the person is assigned to.
2. A supervisor reassigns each of those duties (**Replace** on the duty page, with a reason).
3. If only the login must stop (for example a suspected password compromise): **Login accounts** →
   *Change role / status* → inactive, or *reset password*. Both end existing sessions.
4. History is never deleted. Reactivation is a separate, audited action.

## 4. Lost or stolen duty device
1. The person reports the loss. An administrator opens **Devices** → the device → **Revoke** with a reason.
   The server then rejects further events signed by that key, the device's sessions are revoked, and a
   `DEVICE_REVOCATION` exception is recorded.
2. Review events received after the suspected loss time. They remain stored with their original signatures.
3. Events still queued only on the lost phone are lost, unless the phone is recovered and synchronises before
   revocation. The local database is encrypted with a Keystore-wrapped key, so it is not readable from a
   locked device without that key. This is not verified on hardware in this delivery.
4. The person registers a new device. An administrator approves it after checking the key fingerprint out of band.

## 5. Backup and restoration
1. Back up the database with `pg_dump -Fc` (or managed backups) and copy the evidence directory (Render
   persistent disk snapshot or file copy). The two must be backed up together.
2. Rehearse restoration regularly:
   `SOURCE_URL=… ADMIN_URL=… EVIDENCE_DIR=… scripts/backup-restore-check.sh`. The drill restores into an empty
   database, compares row counts of key tables (including the 2.0 duty tables), checks every evidence
   reference and re-verifies the audit chain. It writes `backup-verification.json` (passed or failed).
3. Set `BACKUP_VERIFICATION_FILE` to that file so the **System status** page shows the last drill result.
   Without it, the page says “not available” rather than guessing.
4. After a real restoration: compare the audit head with an independently stored checkpoint
   (`GET /api/v1/audit-events/checkpoint`), then run `pnpm db:verify-audit`.

## 6. Suspected evidence tampering
1. A hash mismatch on upload already quarantines the bytes and raises a HIGH `EVIDENCE_HASH_MISMATCH`
   exception linked to the duty. The original signed declaration is kept.
2. For an exported package: run the independent verifier
   (`node packages/verifier/dist/cli.js <package.zip>`). `FAIL` identifies the failed check.
3. Compare the server audit chain with an independently stored checkpoint. A rewrite by a database
   superuser is detectable only against such a checkpoint.
4. Record investigation notes on the exception and preserve the package and the verifier output. Do not
   “fix” the data. Use an audited correction only for metadata errors, never for evidence bytes.

## 7. Demo environment hygiene
* Reset the demonstration with `pnpm db:reset-demo`. This drops and recreates **all** PRAMAAN tables; never
  point it at real data.
* Never set `ALLOW_DEMO_LOGIN=true` on a publicly reachable deployment. Keep demo accounts out of production
  entirely.
