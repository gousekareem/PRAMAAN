# ADR-002 — Canonical JSON (RFC 8785 subset) and SHA-256 event hashing

**Status:** Accepted

## Decision
- Event bodies are serialised with *PRAMAAN-CJSON-1*: keys sorted by UTF-16 code units, no
  whitespace, ECMAScript number/string serialisation (as RFC 8785), and **rejection** (not silent
  dropping) of `undefined`, `NaN`, `Infinity`, functions and non-plain objects.
- `eventHash = SHA-256(UTF-8(canonical(body)))` where *body* is a fixed list of 15 fields
  (`schemaVersion … payload, previousEventHash`). Mutable sync fields (state, retries, server
  receipt time) are excluded so historical hashes never change.
- The first event of a device links to `GENESIS_HASH` (64 zeros).
- SHA-256 implementation: `@noble/hashes` in shared code (works in Hermes, Node and browsers);
  `node:crypto` for large file hashing on the server.

## Rejected alternatives
- `JSON.stringify` with insertion order — not deterministic across producers.
- Custom hash constructions — forbidden; only standard primitives are used.
