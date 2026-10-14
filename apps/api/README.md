# @pramaan/api

Express 5 + TypeScript backend. Entry: `src/server.ts` (graceful shutdown, binds to `PORT`), app: `src/app.ts`.

| Folder | Contents |
|---|---|
| `config/` | zod-validated environment (`loadEnv`, production safety checks) |
| `database/` | pool, transaction helper, migration runner + CLI, demo seed + CLI |
| `middleware/` | request IDs, error envelope, bearer auth + RBAC |
| `security/` | Argon2id passwords, JWT/refresh tokens, device public keys + ECDSA verification |
| `ingestion/` | `ingest.ts` (batch semantics), `derive.ts` (patrol logs, check-ins, evidence, flags, movement rule) |
| `spatial/` | PostGIS zone classification |
| `evidence/` | storage driver, streaming upload verification, screen-risk analysis, package/PDF export |
| `services/` | auth sessions, hash-linked audit log, review flags |
| `routes/` | HTTP endpoints (see `docs/api-reference.md`) |
| `events/` | in-process bus for Server-Sent Events |
| `tools/` | `simulate-device.ts` (simulated end-to-end demo), `benchmark.ts`, `create-user.ts`, `verify-audit-cli.ts` |
| `tests/` | Vitest + Supertest integration tests against PostGIS |

Scripts: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm test`, `pnpm db:migrate`, `pnpm db:seed [-- --reset]`,
`pnpm db:verify-audit`, `pnpm simulate -- --password <pw>`, `pnpm bench -- --password <pw>`.
