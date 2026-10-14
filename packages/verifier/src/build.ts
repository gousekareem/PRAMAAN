import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import {
  PACKAGE_DISCLAIMER,
  PACKAGE_FILES,
  PACKAGE_FORMAT,
  type PackageIndex,
} from '@pramaan/event-contracts';

export interface PackageParts {
  evidenceId: string;
  generatedBy: string;
  image: Uint8Array;
  manifest: unknown;
  events: unknown[];
  publicKey: {
    deviceId: string;
    publicKeySpkiBase64: string;
    algorithm: string;
    keyStatus: string;
    revokedAt: string | null;
  };
  serverVerification: unknown;
  custody: unknown[];
  generatedAt?: Date;
}

/** Builds a PRAMAAN-EVIDENCE-PACKAGE-1 ZIP. Used by the API export endpoint and tests. */
export function buildEvidencePackage(parts: PackageParts): {
  zip: Uint8Array;
  index: PackageIndex;
} {
  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
  const content: Record<string, Uint8Array> = {
    [PACKAGE_FILES.image]: parts.image,
    [PACKAGE_FILES.manifest]: json(parts.manifest),
    [PACKAGE_FILES.events]: json(parts.events),
    [PACKAGE_FILES.publicKey]: json(parts.publicKey),
    [PACKAGE_FILES.serverVerification]: json(parts.serverVerification),
    [PACKAGE_FILES.custody]: json(parts.custody),
  };
  const index: PackageIndex = {
    format: PACKAGE_FORMAT,
    evidenceId: parts.evidenceId,
    generatedAt: (parts.generatedAt ?? new Date()).toISOString(),
    generatedBy: parts.generatedBy,
    disclaimer: PACKAGE_DISCLAIMER,
    files: Object.entries(content).map(([path, bytes]) => ({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    })),
  };
  const zip = zipSync(
    { ...content, [PACKAGE_FILES.index]: json(index) },
    { level: 6, mtime: new Date('2026-01-01T00:00:00Z') },
  );
  return { zip, index };
}
