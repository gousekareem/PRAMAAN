import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { eventSignatureMessage } from '@pramaan/event-contracts';
import { sha256 } from './tokens.js';

/** Parses and validates a base64 DER SPKI P-256 public key. Returns null if invalid. */
export function parseDevicePublicKey(
  spkiBase64: string,
): { key: KeyObject; fingerprint: string } | null {
  try {
    if (!/^[A-Za-z0-9+/=]{80,400}$/.test(spkiBase64)) return null;
    const der = Buffer.from(spkiBase64, 'base64');
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      return null;
    return { key, fingerprint: sha256(der) };
  } catch {
    return null;
  }
}

/** Verifies an ECDSA-P256-SHA256 DER signature (Android Keystore "SHA256withECDSA"). */
export function verifyEventSignature(
  key: KeyObject,
  eventHash: string,
  signatureB64: string | null,
): boolean {
  if (!signatureB64) return false;
  try {
    return verify(
      'sha256',
      Buffer.from(eventSignatureMessage(eventHash), 'utf8'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
