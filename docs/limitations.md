# Known limitations (read before evaluating claims)

1. **Academic prototype, not an operational police system.** It has not been commissioned, reviewed,
   approved or deployed by Guntur Railway Police, Indian Railways or any government body. Real use would
   require legal review (incl. the Digital Personal Data Protection Act, 2023), labour/union consultation,
   an independent security assessment and organisational approval.
2. **Android background execution.** Foreground services are not unkillable. Force-stop, OEM battery
   managers (aggressive on several popular brands), Doze, low-memory kills and revoked permissions stop
   collection. Exact alarms need user approval on Android 12+ (denied by default on 13+), full-screen
   intents may be revoked on Android 14+, and location foreground services cannot be silently restarted
   after boot. PRAMAAN records the resulting gaps rather than hiding them.
3. **No authoritative time offline.** Without a network the phone has no NTP. The trusted-time estimate
   depends on the last server anchor and is lost on reboot; device wall-clock times are untrusted.
4. **GPS spoofing residual risk.** Mock-location flags are client-reported and are hidden by common root
   tools; coordinates and speed can be fabricated on compromised devices.
5. **Cellular metadata.** Requires location permission, is frequently partial or redacted, may be
   unavailable on some devices/radios, and a cell does not identify a coach or a precise position.
6. **Biometrics.** BiometricPrompt verifies a match against *some* enrolled biometric on the phone at the
   moment of a check-in. It does not identify the officer to the server, does not prove continuous
   possession, and a second enrolled finger belongs to whoever enrolled it.
7. **Rooted / instrumented devices.** Root, emulator and debugger checks are heuristic and bypassable.
   Play Integrity is not configured (disabled adapter).
8. **Screen-photograph detection** is experimental. Periodic real-world textures produce false positives
   (demonstrated in a test); many screens and all prints produce false negatives.
9. **Key compromise.** A compromised device can sign anything; revocation limits impact only after it is
   detected.
10. **Local database key recovery.** If the Keystore wrapping key is lost (clear data, factory reset,
    some OS updates), unsynchronised local data cannot be decrypted. There is no escrow by design.
11. **Integrity ≠ authenticity.** Hashes and signatures show that data is unchanged since signing and
    which registered key signed it; they do not show the content is true. Exported packages are not
    certified chain-of-custody records and make no claim of legal admissibility.
12. **Unanchored history.** Events created and rewritten on a compromised phone before the first sync
    cannot be distinguished from genuine ones.
13. **Rejected events create server-side gaps.** A rejected event leaves its sequence slot empty on the
    server; subsequent events are accepted with `GAP_BEFORE` and an exported package reports the gap as
    `INCOMPLETE` rather than `PASS` (observed during testing).
14. **Server.** Single-instance design: the SSE event bus is in-process and the audit chain serialises
    writes through one row lock. Evidence storage is a local filesystem (requires a Render persistent disk;
    object storage is future work). The demo zones are illustrative rectangles, not surveyed boundaries.
15. **Verification boundary of this delivery.** The Kotlin/Android code was **not compiled or run** in the
    authoring environment (no Android SDK; Google Maven blocked). Only Android-independent Kotlin logic was
    compiled and unit-tested on a JVM. No physical-device test was performed. The Render deployment was not
    performed (no account credentials). See `docs/device-test-checklist.md`.
16. **Mobile UI tests.** React Native screens are type-checked and bundled with Metro but have no
    component tests; business logic beneath them is unit-tested.
17. **Operational rules are prototype defaults.** The role permission sets, data scopes, duty-category
    eligibility, check-in intervals, reporting windows and grace periods were chosen for the demonstration
    from the information supplied. They are configurable and **must be validated by the Andhra Pradesh
    Railway Police** before any use. AR as a constable classification must also be confirmed.
18. **No official integration.** There is no connection to departmental HR, leave, rostering, CCTNS or railway
    train-running systems. Personnel, units, trains, VIP labels and incidents are entered manually (synthetic
    in the demo). Unavailability categories are generic; no leave rules are modelled.
19. **Notifications are in-app only.** There is no push, SMS or e-mail channel. `DELIVERED` means the
    recipient's signed-in app retrieved the notification, not that the person read it on a phone.
20. **Exception evaluation is periodic and server-side.** Delayed reporting and sync failures are inferred
    from the absence of synchronised events. An offline device that later synchronises can produce
    exceptions that turn out to be explained. Device-reported start times are untrusted.
21. **Restricted-duty access is coarse.** `duty.view_restricted` is all-or-nothing per role. A per-duty
    access list, field-level redaction policies and approval for each disclosure are future work.
22. **Audit scope for non-global users** is computed from the actor's and target's scope (personnel,
    duties, evidence). Audit records about other kinds of target (for example policy changes) are visible
    only to global roles.
23. **Localisation.** All new screens use the central English dictionary, and a Telugu dictionary file
    exists but is intentionally empty (it needs reviewed translations). Several PRAMAAN 1.0 dashboard pages
    and the Android app still contain inline English strings.
24. **Android UI for duty assignments** (category, instructions, accept and acknowledge buttons, per-category
    check-in policy) is type-checked and its scheduling logic unit-tested. Like the rest of the Android app,
    it was not run on a device in this delivery.
25. **Single-instance evaluator.** The exception evaluator runs inside the API process. With several
    instances it would run on each one (deduplicated by flag keys), which is harmless but wasteful; a
    scheduled job would be preferable.
