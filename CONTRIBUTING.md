# Contributing

1. `scripts\setup-windows.ps1` (or the manual steps in the guide).
2. Keep the canonical event format stable: any change to `packages/event-contracts/src/canonical.ts`
   or `hashableEventBody` invalidates stored hashes and requires a new `schemaVersion`.
3. Database changes: add a new `database/migrations/NNNN_name.sql`; never edit an applied migration
   (the runner rejects checksum changes).
4. Before a commit: `pnpm lint`, `pnpm typecheck`, `scripts\run-tests.ps1`.
5. Do not add real personal data, real police records or real evidence to fixtures or seeds.
6. Documentation must describe implemented behaviour only; mark hardware-dependent or unverified
   behaviour explicitly.
