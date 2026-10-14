# ADR-006 — Trusted-time model (wall clock + monotonic clock + server anchor)

**Status:** Accepted

An offline phone cannot know authoritative time. Each event stores the device wall clock (untrusted),
`SystemClock.elapsedRealtime()` and a boot identifier. Every successful sync records a server time
anchor; while the boot is unchanged the estimate is `anchor.serverTime + (monotonic − anchor.monotonic)`
with uncertainty `50 ms + RTT/2 + 100 ppm × elapsed`. After a reboot the estimate is `null`
(`DEVICE_WALL_CLOCK_UNANCHORED`). Rollback, forward jumps and wall/monotonic divergence produce
`CLOCK_ANOMALY_DETECTED` events. Original timestamps are never rewritten; the server separately stores
`server_received_at` and `server_processed_at`.
