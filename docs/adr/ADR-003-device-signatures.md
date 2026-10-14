# ADR-003 — ECDSA P-256 device signatures in Android Keystore

**Status:** Accepted

## Context
A hash only proves that content is unchanged since it was hashed; a modified client can hash
fabricated data. Events must therefore be bound to a key that cannot be exported from the
registered phone.

## Decision
- Each device generates an **EC P-256** key pair in **Android Keystore** (StrongBox when available,
  else TEE) — algorithm `SHA256withECDSA`, signature encoded as DER, public key as X.509 SPKI.
- Ed25519 was considered but P-256 is supported by Android Keystore on every API level ≥ 24 and is
  verified natively by Node.js `crypto.verify`.
- Signed message: `"PRAMAAN-EVENT-V1:" + eventHash` (domain separation).
- Registration sends only the public key; an **administrator approves** it after comparing the
  SHA-256 fingerprint with the officer (out-of-band). Revocation stops ingestion immediately.
- A separate auth-per-use EC key (`setUserAuthenticationRequired`, BIOMETRIC_STRONG) signs a nonce
  during each check-in, giving hardware-attested evidence that BiometricPrompt succeeded.

## Consequences / limits
- Reinstalling the app deletes Keystore keys → a new device registration is required.
- A rooted/instrumented phone can still *use* the key to sign fabricated events; signatures prove
  "produced by software holding this device key", not truthfulness.
