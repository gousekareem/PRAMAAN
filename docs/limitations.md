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
