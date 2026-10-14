# ADR-001 — Monorepo layout and technology stack

**Status:** Accepted · **Date:** 2026-10-13

## Context
PRAMAAN needs an Android duty app, an API, a supervisory dashboard and one shared definition of
how events are canonicalised and hashed. A hash computed differently by two components would make
every integrity check meaningless.

## Decision
- One repository. `packages/event-contracts` (canonical JSON, hashing, chain/clock/rules logic),
  `packages/validation` (zod schemas) and `packages/verifier` (independent package verifier) are
  consumed by the API, the dashboard tooling and — from source, via Metro — the mobile app.
- API: Node.js 22 LTS + TypeScript (strict) + Express 5 + `pg` (raw SQL).
- Database: PostgreSQL 16 + PostGIS 3.4.
- Dashboard: React 19 + Vite + Tailwind CSS 3 + React-Leaflet.
- Mobile: React Native CLI 0.87 (no Expo) + Kotlin native modules.
- pnpm workspace for API/dashboard/packages; the React Native app is installed with **npm** outside
  the workspace because the RN Gradle plugin and autolinking expect a conventional `node_modules`
  beside `android/`.

## Consequences
- The same `computeEventHash` code runs on the phone, the server and in the verifier.
- Two package managers must be documented (pnpm + npm); the mobile app pins its own copies of
  `@noble/hashes` and `zod` that Metro resolves for the shared sources.
