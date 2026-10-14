# ADR-007 — Evidence capture, sealing and storage

**Status:** Accepted

- Capture only through an unexported CameraX activity; no gallery, picker or share-target path exists.
- The JPEG is streamed once through SHA-256 and AES-256-GCM (Keystore key) into
  `files/evidence/<random>.enc`; the plaintext temp file is deleted. Interrupted seals (`*.part`) are
  removed at start-up.
- The authoritative record is the canonical manifest (bound to the image hash) embedded in a signed
  `EVIDENCE_CAPTURED` event — EXIF is not relied upon.
- Server: bytes are streamed through SHA-256 with a hard size limit, file-signature checked, compared
  with the signed declaration, stored under random names, re-verified on every read/export.
  Mismatches are quarantined (kept), never accepted.
- Server storage driver: local filesystem, which on Render MUST be a persistent disk. Object storage
  is future work (documented, not implemented).
