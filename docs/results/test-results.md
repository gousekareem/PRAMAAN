# PRAMAAN automated test results

Generated: 2026-10-15T12:43:12.616Z · Node v22.22.0 · linux

| Suite | Passed | Failed | Skipped | Describe blocks |
|---|---:|---:|---:|---:|
| Shared contracts (canonical JSON, hashing, chain, clock, rules, screen-risk) | 35 | 0 | 0 | 12 |
| Validation schemas | 5 | 0 | 0 | 2 |
| Independent evidence-package verifier | 8 | 0 | 0 | 2 |
| Backend API + PostgreSQL/PostGIS integration | 100 | 0 | 0 | 32 |
| Admin dashboard (React Testing Library) | 46 | 0 | 0 | 21 |
| Mobile business logic (ledger, sync, check-ins, evidence) | 41 | 0 | 0 | 12 |
| Kotlin pure-JVM unit tests (CryptoFormat, PostureRules) | 7 | 0 | 0 | 2 |
| **Total** | **242** | **0** | **0** | |

## Quality gates

| Gate | Result |
|---|---|
| lint | pass (exit 0) |
| typecheck-api | pass (exit 0) |
| typecheck-admin | pass (exit 0) |
| typecheck-mobile | pass (exit 0) |
| build-api | pass (exit 0) |
| build-admin | pass (exit 0) |

## Not executed in this environment

- Android Gradle build (`assembleDebug`/`assembleRelease`) and Android-framework unit/instrumented tests: Android SDK and Google/Maven repositories unavailable.
- Behaviour on physical Android hardware (biometric prompt, CameraX capture, Keystore/StrongBox, foreground service, alarms, sensors, SQLCipher at runtime).
- Render deployment (no credentials).

## Shared contracts (canonical JSON, hashing, chain, clock, rules, screen-risk)

- ✅ canonicalize (PRAMAAN-CJSON-1) › sorts keys recursively and removes whitespace
- ✅ canonicalize (PRAMAAN-CJSON-1) › is independent of key insertion order
- ✅ canonicalize (PRAMAAN-CJSON-1) › uses ECMAScript number serialization (RFC 8785 test values)
- ✅ canonicalize (PRAMAAN-CJSON-1) › escapes strings deterministically
- ✅ canonicalize (PRAMAAN-CJSON-1) › rejects ambiguous values instead of silently dropping them
- ✅ canonicalize (PRAMAAN-CJSON-1) › fallback UTF-8 encoder matches TextEncoder
- ✅ canonicalize (PRAMAAN-CJSON-1) › sha256Hex matches the NIST "abc" vector
- ✅ event hash chain › verifies an intact chain
- ✅ event hash chain › hash excludes mutable sync fields
- ✅ event hash chain › detects a modified payload
- ✅ event hash chain › detects a rehashed modification through the broken link to the next event
- ✅ event hash chain › reports (and does not repair) a sequence gap
- ✅ event hash chain › detects duplicates and invalid genesis
- ✅ event hash chain › detects truncation and full rewrite only against a trusted anchor
- ✅ trusted time model › estimates time from the anchor and monotonic clock with growing uncertainty
- ✅ trusted time model › is unanchored after a reboot or without an anchor (never invents NTP time)
- ✅ trusted time model › detects wall-clock rollback while monotonic time advances
- ✅ trusted time model › detects forward clock jumps
- ✅ trusted time model › accepts normal progression
- ✅ trusted time model › flags a reboot as informational
- ✅ trusted time model › flags skew against anchored trusted time
- ✅ trusted time model › server flags future device timestamps
- ✅ evidence manifest › accepts a well-formed manifest and produces a stable hash
- ✅ evidence manifest › rejects fabricated location data marked unavailable and gallery provenance
- ✅ evidence manifest › rejects out-of-range coordinates and oversize images
- ✅ EXPERIMENTAL screen-recapture risk (synthetic patterns only) › scores a moiré-like periodic grid high
- ✅ EXPERIMENTAL screen-recapture risk (synthetic patterns only) › scores natural-like noise and smooth gradients low
- ✅ EXPERIMENTAL screen-recapture risk (synthetic patterns only) › KNOWN FALSE POSITIVE: a real-world periodic texture (tiles/grille) also scores high
- ✅ movement correlation rule › haversine is accurate to ~1 m for short distances
- ✅ movement correlation rule › flags two captures in different zones 2h apart with < 50 steps
- ✅ movement correlation rule › does not flag when transit was suspected (train)
- ✅ movement correlation rule › does not flag across reboot / counter reset / sensor interruption
- ✅ movement correlation rule › does not flag when enough steps were taken or the distance is within accuracy
- ✅ transit detector › requires two consecutive reliable samples above 60 km/h
- ✅ transit detector › ignores inaccurate samples

## Validation schemas

- ✅ validation schemas › has a payload schema for every event type
- ✅ validation schemas › accepts a valid envelope and rejects unknown fields (strict)
- ✅ validation schemas › rejects malformed identifiers, hashes and timestamps
- ✅ validation schemas › rejects malformed GPS coordinates
- ✅ validation schemas › enforces batch bounds

## Independent evidence-package verifier

- ✅ independent evidence package verifier › PASSes an untouched package
- ✅ independent evidence package verifier › FAILs when a single byte of the image is modified
- ✅ independent evidence package verifier › FAILs when the image is replaced AND the index is rewritten (manifest binding)
- ✅ independent evidence package verifier › FAILs when manifest metadata is edited and rehashed (signature + event binding)
- ✅ independent evidence package verifier › FAILs when an event is re-hashed with a forged signature key
- ✅ independent evidence package verifier › detects modified custody records and broken audit links
- ✅ independent evidence package verifier › reports INCOMPLETE when required files are missing and FAIL for unlisted files
- ✅ independent evidence package verifier › FAILs a non-ZIP input

## Backend API + PostgreSQL/PostGIS integration

- ✅ health › GET /health is a liveness probe
- ✅ health › GET /ready checks database, PostGIS, migrations and storage
- ✅ authentication › web login sets an httpOnly refresh cookie and never returns the refresh token in the body
- ✅ authentication › rejects bad credentials with a generic message and request id
- ✅ authentication › separates officer (mobile) and dashboard (web) clients
- ✅ authentication › rotates refresh tokens (cookie needs the anti-CSRF header) and detects reuse
- ✅ authentication › mobile refresh uses the body token
- ✅ authentication › logout revokes the session (access token no longer accepted)
- ✅ authentication › rejects expired and forged access tokens
- ✅ authentication › locks the account after repeated failures
- ✅ authorization and validation › requires authentication on protected endpoints
- ✅ authorization and validation › enforces roles
- ✅ authorization and validation › prevents broken object-level authorization (officer cannot read another officer)
- ✅ authorization and validation › validates path, query and body input
- ✅ authorization and validation › rejects oversized JSON bodies
- ✅ authorization and validation › rejects CORS requests from non-allowlisted origins
- ✅ authorization and validation › sets secure headers
- ✅ rate limiting › limits login attempts
- ✅ PostGIS spatial validation › classifies inside / within accuracy / outside against assigned zones (lon,lat order)
- ✅ PostGIS spatial validation › creates a spatial exception flag only beyond the reported accuracy
- ✅ PostGIS spatial validation › flags a client-reported mock-location indicator as MEDIUM review item, not a conclusion
- ✅ PostGIS spatial validation › labels stale and delayed observations instead of calling them live
- ✅ check-in lifecycle › keeps a missed check-in and a later late acknowledgment as separate records
- ✅ movement correlation › flags captures 2 h apart in different zones with < 50 steps, but not when transit was suspected
- ✅ alerts workflow and audit chain › requires notes to resolve, restricts reviewers, audits every action and never alters the observation
- ✅ alerts workflow and audit chain › verifies the audit hash chain and detects tampering by a privileged database user
- ✅ duties and exports › rejects overlapping duties and audits creation
- ✅ duties and exports › exports patrol logs as CSV with formula-injection protection and audit
- ✅ duties and exports › paginates
- ✅ four duty categories › an authorised SI can create and view every category with flexible staffing
- ✅ four duty categories › enforces the category-specific reference fields
- ✅ four duty categories › a single person is a valid assignment and staffing gaps are warnings, not rejections
- ✅ assignment rules › detects overlapping assignments and requires an authorised, reasoned override
- ✅ assignment rules › flags leave/unavailability conflicts
- ✅ assignment rules › rejects newly assigning inactive personnel
- ✅ assignment rules › applies configurable eligibility (BLOCK or WARN), never a hard-coded combination
- ✅ assignment rules › rejects invalid status transitions
- ✅ assignment rules › rejects unauthorised modifications
- ✅ history-preserving changes › replacement, removal and schedule changes keep the original record with reason, actor and time
- ✅ history-preserving changes › versioned instructions with acknowledgement by assigned personnel only
- ✅ history-preserving changes › acceptance by every assigned person moves the duty to ACCEPTED
- ✅ history-preserving changes › records a handover and lets the involved personnel acknowledge it
- ✅ history-preserving changes › notifications are QUEUED until the recipient retrieves them
- ✅ exceptions and corrections › raises reporting-delay and overdue exceptions idempotently, and never as misconduct
- ✅ exceptions and corrections › corrections never overwrite the original and need a different approver
- ✅ reports, roster, overview, policy and system status › exports CSV and PDF for every report kind and audits each export
- ✅ reports, roster, overview, policy and system status › dashboard figures come from stored records within scope
- ✅ reports, roster, overview, policy and system status › protects the system status page and reports measured values only
- ✅ reports, roster, overview, policy and system status › category check-in policy is configurable and reaches the device duty list
- ✅ evidence upload verification › refuses bytes for which no signed capture event exists
- ✅ evidence upload verification › verifies matching bytes server-side and is idempotent
- ✅ evidence upload verification › quarantines modified bytes, raises a HIGH flag, and accepts a correct retry
- ✅ evidence upload verification › rejects oversize uploads and non-JPEG content
- ✅ evidence upload verification › blocks a client from relabelling evidence into another officer’s record
- ✅ evidence upload verification › rejects a capture event whose manifest hash does not bind to the manifest
- ✅ evidence access, export and independent verification › restricts image content to supervisors/admins and audits access
- ✅ evidence access, export and independent verification › exports a package that the independent verifier PASSes, and FAILs once modified
- ✅ evidence access, export and independent verification › renders a PDF report and a JSON manifest export
- ✅ evidence access, export and independent verification › re-verifies stored bytes on retrieval and detects storage tampering
- ✅ evidence access, export and independent verification › evidence declarations are immutable in the database
- ✅ evidence access, export and independent verification › lists and filters evidence by hash prefix
- ✅ upgrade from the PRAMAAN 1.0 schema › keeps existing records intact and maps legacy ranks
- ✅ duty-linked check-ins › device duty start moves the assignment to IN_PROGRESS and keeps device time separate from server time
- ✅ duty-linked check-ins › links each check-in to the personnel record and the duty
- ✅ duty-linked check-ins › events recorded offline sync later without duplicates, even when a batch is replayed
- ✅ evidence on a restricted duty › accepts in-app evidence linked to the duty and verifies the SHA-256
- ✅ evidence on a restricted duty › restricts evidence metadata and images to authorised users
- ✅ evidence on a restricted duty › modified evidence fails verification and the exception is linked to the duty
- ✅ evidence on a restricted duty › a field user’s personal summary shows server-side sync and evidence status
- ✅ rank demonstration accounts › every requested demo account can sign in to the dashboard with its documented password
- ✅ rank demonstration accounts › uses exactly the requested login convention
- ✅ rank demonstration accounts › stores passwords only as Argon2id hashes
- ✅ rank demonstration accounts › rejects invalid credentials
- ✅ rank demonstration accounts › represents PC — AR as a personnel attribute, not an extra rank or permission
- ✅ rank demonstration accounts › allows field accounts on the duty device and refuses DSP / administrator there
- ✅ rank demonstration accounts › logout revokes the session token
- ✅ rank demonstration accounts › lists and revokes own sessions only
- ✅ rank demonstration accounts › refuses demo logins in production unless explicitly enabled
- ✅ server-side authorisation › HG cannot reach administrative or supervisory endpoints
- ✅ server-side authorisation › permissions come from the database, not from the token claim
- ✅ server-side authorisation › users cannot change their own role, status or personnel record
- ✅ server-side authorisation › an administrator role change takes effect immediately and ends the old sessions
- ✅ server-side authorisation › inactive personnel cannot authenticate and existing sessions stop working
- ✅ server-side authorisation › personnel records cannot be deleted
- ✅ scope boundaries › HC and SI see only their station; CI sees the circle; DSP sees the sub-division
- ✅ scope boundaries › out-of-scope records are reported as not found
- ✅ scope boundaries › field accounts see only their own duties and own record
- ✅ scope boundaries › restricted VIP / incident details are hidden from users without duty.view_restricted
- ✅ scope boundaries › reports are scoped to the caller
- ✅ device lifecycle › rejects events from pending, unknown and revoked devices
- ✅ device lifecycle › rejects malformed public keys and re-registration with a different key
- ✅ POST /api/v1/sync/batch › accepts a valid signed batch and is idempotent on replay
- ✅ POST /api/v1/sync/batch › rejects modified events (hash mismatch) and preserves the rejected submission
- ✅ POST /api/v1/sync/batch › rejects forged client hashes that are re-computed but not signed by the device key
- ✅ POST /api/v1/sync/batch › reports sequence gaps, accepts late fill, and rejects broken links
- ✅ POST /api/v1/sync/batch › preserves conflicting duplicates instead of last-write-wins
- ✅ POST /api/v1/sync/batch › distinguishes invalid payloads, schema versions, duty and officer mismatches
- ✅ POST /api/v1/sync/batch › rolls back the whole batch on a server failure and accepts the identical retry
- ✅ POST /api/v1/sync/batch › records clock anomalies and future timestamps as review flags without rewriting times
- ✅ POST /api/v1/sync/batch › device_events are append-only at the database level

## Admin dashboard (React Testing Library)

- ✅ route guards and role-based visibility › redirects anonymous users to sign-in
- ✅ route guards and role-based visibility › blocks roles that are not allowed
- ✅ route guards and role-based visibility › allows permitted roles
- ✅ route guards and role-based visibility › hides audit navigation from reviewers
- ✅ route guards and role-based visibility › shows field personnel only their own areas (navigation follows permissions)
- ✅ route guards and role-based visibility › gives the system administrator the administration section
- ✅ route guards and role-based visibility › guards pages by permission
- ✅ status labels › never describes an observation as "live"
- ✅ status labels › labels evidence states explicitly
- ✅ state components › shows loading and API errors with request id
- ✅ state components › paginates
- ✅ state components › disables previous on the first page
- ✅ evidence verification display › shows verified integrity but warns that integrity is not authenticity
- ✅ evidence verification display › shows rejected evidence
- ✅ evidence verification display › shows awaiting upload
- ✅ AppFooter › shows the exact copyright notice and a safe LinkedIn attribution link
- ✅ AppFooter › is rendered once by the shared layout on /
- ✅ AppFooter › is rendered once by the shared layout on /map
- ✅ AppFooter › is rendered once by the shared layout on /officers
- ✅ AppFooter › is rendered once by the shared layout on /duties
- ✅ AppFooter › is rendered once by the shared layout on /duties/category/train-beats
- ✅ AppFooter › is rendered once by the shared layout on /roster
- ✅ AppFooter › is rendered once by the shared layout on /checkins
- ✅ AppFooter › is rendered once by the shared layout on /personnel
- ✅ AppFooter › is rendered once by the shared layout on /reports
- ✅ AppFooter › is rendered once by the shared layout on /my
- ✅ AppFooter › is rendered once by the shared layout on /account
- ✅ AppFooter › is rendered once by the shared layout on /evidence
- ✅ AppFooter › is rendered once by the shared layout on /alerts
- ✅ AppFooter › is rendered once by the shared layout on /audit
- ✅ AppFooter › is rendered once by the shared layout on /devices
- ✅ AppFooter › is rendered once by the shared layout on /admin/system
- ✅ duty assignments list › shows category, restricted placeholder title, personnel classes and exceptions
- ✅ duty detail › shows history-preserving changes, device vs server times and permitted actions only
- ✅ roster › marks conflicts and unavailability
- ✅ check-ins & presence › states that GPS and check-ins are not proof of presence
- ✅ reports › offers exports only to accounts with reports.export
- ✅ my duties › lets assigned personnel accept and see instructions pending acknowledgement
- ✅ system status › shows backup status as not available unless a verification result exists
- ✅ Alerts page › lets a supervisor acknowledge a flag after confirmation
- ✅ Alerts page › requires a note before resolving
- ✅ Alerts page › shows no action controls to read-only reviewers
- ✅ Alerts page › shows API errors with the request id
- ✅ Devices page › shows approve/revoke only to administrators
- ✅ Overview page › renders loading, then figures computed by the server within scope
- ✅ Map page › renders observations with explicit freshness and accuracy labels

## Mobile business logic (ledger, sync, check-ins, evidence)

- ✅ cognitive challenge › generates uniformly distributed 3-digit codes
- ✅ cognitive challenge › expires after the 5 s limit measured on the monotonic clock
- ✅ cognitive challenge › secureRandomInt stays in range and is unbiased enough
- ✅ check-in scheduling › schedules within the 90–150 min window and is not a fixed interval
- ✅ check-in scheduling › prevents duplicate scheduling across repeated worker runs and restarts
- ✅ check-in scheduling › does not schedule past the end of duty and respects quiet periods
- ✅ check-in scheduling › records a missed check-in after the deadline and a late acknowledgment as a separate event
- ✅ check-in scheduling › acknowledges in time and cancels the alarm
- ✅ check-in scheduling › cannot extend the response window by turning the wall clock back (same boot)
- ✅ check-in scheduling › classifies a check-in missed while the device was rebooted
- ✅ check-in scheduling › records biometric cancellation and wrong codes without acknowledging
- ✅ check-in scheduling › counts consecutive misses for escalation
- ✅ per-category check-in policy (duty assignments) › maps the server category policy and falls back to defaults for invalid values
- ✅ per-category check-in policy (duty assignments) › schedules within the duty category window instead of the global default
- ✅ evidence capture pipeline › builds a valid manifest bound to the image hash and records it atomically with the signed event
- ✅ evidence capture pipeline › discards the sealed file and records nothing when validation fails
- ✅ evidence capture pipeline › emits a mock-location indicator event when the platform flags the fix
- ✅ observation processing (data minimisation + transit) › sub-samples locations, records step milestones and suspects transit above ~60 km/h
- ✅ retention and encryption guard › compacts only acknowledged, verified, old events and keeps the chain verifiable
- ✅ retention and encryption guard › refuses invalid keys before touching the native library
- ✅ retention and encryption guard › refuses to open (and closes) the database when SQLCipher is absent — no plaintext fallback (mocked native layer)
- ✅ local ledger › creates canonical, hash-linked, signed events with a persistent outbox entry
- ✅ local ledger › never resets sequence numbers across process restarts
- ✅ local ledger › rolls back the whole append when a companion statement fails (no orphan events)
- ✅ local ledger › rejects invalid payloads before they reach the ledger
- ✅ local ledger › serialises concurrent appends without forking the chain
- ✅ local ledger › appends CLOCK_ANOMALY_DETECTED when the wall clock is rolled back offline, preserving original times
- ✅ local ledger › uses the server time anchor + monotonic clock for trusted-time estimates (offline 8 h)
- ✅ local ledger › detects local tampering of a stored envelope
- ✅ offline-first sync engine › keeps recording offline and syncs the whole queue when connectivity returns
- ✅ offline-first sync engine › never deletes events after a successful upload (they are marked ACKNOWLEDGED)
- ✅ offline-first sync engine › retries a failed batch with the SAME batch id (idempotent replay) and bounded backoff
- ✅ offline-first sync engine › treats captive portals, DNS failures and 5xx as failures, not success
- ✅ offline-first sync engine › marks only server-confirmed events; unanswered events return to the queue
- ✅ offline-first sync engine › keeps server-rejected events locally with the reason (never silently dropped)
- ✅ offline-first sync engine › refreshes an expired session once, then reports AUTH_REQUIRED
- ✅ offline-first sync engine › re-batches under a new id after an idempotency-key collision (409)
- ✅ offline-first sync engine › survives app termination mid-sync: rows stay ASSIGNED and are replayed by a new engine
- ✅ offline-first sync engine › uploads evidence only after its event is acknowledged and recovers interrupted uploads
- ✅ offline-first sync engine › keeps the original when the server reports a hash mismatch
- ✅ offline-first sync engine › backoff grows exponentially, is jittered and bounded
