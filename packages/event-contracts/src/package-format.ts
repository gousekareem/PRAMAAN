/**
 * Exported evidence package format (PRAMAAN-EVIDENCE-PACKAGE-1).
 *
 * A package is a ZIP archive containing:
 *   package-index.json   – this index (lists every other file with its SHA-256)
 *   evidence/original.jpg – original image bytes as received and verified by the server
 *   evidence/manifest.json – canonical evidence manifest declared by the device
 *   ledger/events.json    – device ledger events of the duty session (signed, hash-linked)
 *   device/public-key.json – registered device public key (SPKI, base64) and key status
 *   server/verification.json – server-side verification results at export time
 *   custody/audit-events.json – server audit (chain-of-custody) events for this evidence
 */
export const PACKAGE_FORMAT = 'PRAMAAN-EVIDENCE-PACKAGE-1' as const;

export const PACKAGE_FILES = {
  index: 'package-index.json',
  image: 'evidence/original.jpg',
  manifest: 'evidence/manifest.json',
  events: 'ledger/events.json',
  publicKey: 'device/public-key.json',
  serverVerification: 'server/verification.json',
  custody: 'custody/audit-events.json',
} as const;

export interface PackageIndexEntry {
  path: string;
  sha256: string;
  byteLength: number;
}

export interface PackageIndex {
  format: typeof PACKAGE_FORMAT;
  evidenceId: string;
  generatedAt: string;
  generatedBy: string;
  disclaimer: string;
  files: PackageIndexEntry[];
}

export const PACKAGE_DISCLAIMER =
  'Cryptographic checks confirm only that the files are unchanged since they were hashed and signed, ' +
  'and that signatures match the registered device key. They do not prove that the depicted scene, ' +
  'time, location or identity are genuine, and this package is not a certified chain-of-custody record.';
