# Performance targets and measured results

**Method.** `pnpm bench -- --api http://localhost:4000 --password <pw> --package <zip>` (apps/api/src/tools/benchmark.ts)
on linux x64, Node v22.22.0, PostgreSQL 16.x + PostGIS 3.4 on the same 2-vCPU / 7 GiB host, measured 2026-10-13T06:09:33.724Z.
Single-machine measurement; API, PostgreSQL and the client ran on the same host. These are single-run measurements on a development machine, not guarantees.

| Metric | Target (prototype) | Measured |
|---|---|---|
| Canonical event hashing | ≥ 5 000 events/s | **42,792 events/s** (20,000 events in 467.4 ms) |
| SHA-256 of an 8 MiB evidence buffer | ≤ 200 ms | mean **22.553 ms**, p95 33.279 ms |
| PostGIS zone classification per observation | ≤ 20 ms p95 | mean **0.691 ms**, p95 1.181 ms (n = 500) |
| Sync batch of 50 signed events (HTTP, full verification + derivation) | ≤ 2 s p95 | mean **177.192 ms**, p95 217.482 ms ≈ 282 events/s |
| Independent package verification | ≤ 1 s | mean **6.666 ms**, p95 10.523 ms |
| Dashboard production bundle | ≤ 1 MB JS (gzip ≤ 300 kB) | 727 kB JS, 198 kB gzip (vite build) |

**Interpretation.** An 8-hour offline shift (≈ 100 location events + ~5 check-ins × 6 events + evidence)
produces a few hundred events, i.e. well under 10 batches. Mobile-side hashing/signing throughput on real
phones (Hermes + Keystore signing) was **not measured**; Keystore ECDSA signing typically takes milliseconds
to tens of milliseconds per call depending on TEE/StrongBox and should be benchmarked on target devices.
