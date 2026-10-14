import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { unzipSync } from 'fflate';
import {
  canonicalize,
  computeAuditHash,
  computeManifestHash,
  eventSignatureMessage,
  PACKAGE_FILES,
  PACKAGE_FORMAT,
  validateManifest,
  verifyChain,
  type AuditRecord,
  type EvidenceManifest,
  type PackageIndex,
  type SignedEvent,
} from '@pramaan/event-contracts';

export type CheckStatus = 'PASS' | 'FAIL' | 'INCOMPLETE';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface VerificationReport {
  status: CheckStatus;
  evidenceId: string | null;
  checkedAt: string;
  checks: CheckResult[];
  disclaimer: string;
}

const DISCLAIMER =
  'A PASS confirms only the cryptographic and structural checks listed. It does not prove that the ' +
  'photographed scene, the recorded time, the location or the identity of the person are genuine.';

function sha256(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

function parseJson<T>(bytes: Uint8Array | undefined): T | undefined {
  if (!bytes) return undefined;
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}

export function verifyEventSignature(e: SignedEvent, spkiBase64: string): boolean {
  if (!e.deviceSignature) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(
      'sha256',
      Buffer.from(eventSignatureMessage(e.eventHash), 'utf8'),
      key,
      Buffer.from(e.deviceSignature, 'base64'),
    );
  } catch {
    return false;
  }
}

export function verifyPackageFiles(files: Record<string, Uint8Array>): VerificationReport {
  const checks: CheckResult[] = [];
  const add = (id: string, status: CheckStatus, detail: string) =>
    checks.push({ id, status, detail });
  let evidenceId: string | null = null;

  const index = (() => {
    try {
      return parseJson<PackageIndex>(files[PACKAGE_FILES.index]);
    } catch {
      return undefined;
    }
  })();
  if (!index) {
    add('index.present', 'FAIL', 'package-index.json missing or not valid JSON');
    return finish();
  }
  if (index.format !== PACKAGE_FORMAT) {
    add('index.format', 'FAIL', `Unsupported package format ${String(index.format)}`);
    return finish();
  }
  evidenceId = index.evidenceId;
  add('index.format', 'PASS', `Format ${index.format}`);

  // 1. Every listed file is present and unmodified.
  const listed = new Set<string>();
  for (const entry of index.files) {
    listed.add(entry.path);
    const f = files[entry.path];
    if (!f) add(`file.${entry.path}`, 'INCOMPLETE', 'Listed file is missing from the package');
    else if (sha256(f) !== entry.sha256 || f.byteLength !== entry.byteLength)
      add(
        `file.${entry.path}`,
        'FAIL',
        `SHA-256 mismatch: expected ${entry.sha256}, got ${sha256(f)}`,
      );
    else add(`file.${entry.path}`, 'PASS', `SHA-256 ${entry.sha256}`);
  }
  for (const p of Object.keys(files)) {
    if (p !== PACKAGE_FILES.index && !p.endsWith('/') && !listed.has(p))
      add(`file.${p}`, 'FAIL', 'File present in package but not listed in the index');
  }
  for (const required of [
    PACKAGE_FILES.image,
    PACKAGE_FILES.manifest,
    PACKAGE_FILES.events,
    PACKAGE_FILES.publicKey,
  ]) {
    if (!files[required]) add(`required.${required}`, 'INCOMPLETE', 'Required file missing');
  }

  const image = files[PACKAGE_FILES.image];
  let manifest: EvidenceManifest | undefined;
  let events: SignedEvent[] = [];
  let pub: { publicKeySpkiBase64: string; keyStatus: string; revokedAt: string | null } | undefined;
  try {
    manifest = parseJson<EvidenceManifest>(files[PACKAGE_FILES.manifest]);
    events = parseJson<SignedEvent[]>(files[PACKAGE_FILES.events]) ?? [];
    pub = parseJson(files[PACKAGE_FILES.publicKey]);
  } catch {
    add('json.parse', 'FAIL', 'A JSON file in the package could not be parsed');
    return finish();
  }

  // 2. Original image bytes vs manifest.
  if (image && manifest) {
    const isJpeg = image.length > 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    add(
      'image.signature',
      isJpeg ? 'PASS' : 'FAIL',
      isJpeg ? 'JPEG file signature present' : 'Not a JPEG file',
    );
    const h = sha256(image);
    add(
      'image.sha256',
      h === manifest.image.sha256 ? 'PASS' : 'FAIL',
      `computed ${h}, manifest ${manifest.image.sha256}`,
    );
    add(
      'image.length',
      image.byteLength === manifest.image.byteLength ? 'PASS' : 'FAIL',
      `computed ${image.byteLength} bytes, manifest ${manifest.image.byteLength}`,
    );
  }
  if (manifest) {
    const issues = validateManifest(manifest);
    add(
      'manifest.metadata',
      issues.length ? 'FAIL' : 'PASS',
      issues.length
        ? issues.map((i) => `${i.field}: ${i.problem}`).join('; ')
        : 'Required metadata present and plausible',
    );
    if (manifest.evidenceId !== evidenceId)
      add('manifest.evidenceId', 'FAIL', 'Manifest evidence ID differs from package index');
  }

  // 3. Ledger events: the capture event binds image + manifest hashes.
  const capture = events.find(
    (e) =>
      e.eventType === 'EVIDENCE_CAPTURED' &&
      (e.payload as { evidenceId?: string }).evidenceId === evidenceId,
  );
  if (!capture)
    add(
      'ledger.captureEvent',
      'INCOMPLETE',
      'EVIDENCE_CAPTURED event for this evidence not included',
    );
  else if (manifest) {
    const p = capture.payload as { imageSha256: string; manifestSha256: string; manifest: unknown };
    const mh = computeManifestHash(manifest);
    add(
      'ledger.manifestHash',
      mh === p.manifestSha256 ? 'PASS' : 'FAIL',
      `computed ${mh}, event ${p.manifestSha256}`,
    );
    add(
      'ledger.imageHash',
      p.imageSha256 === manifest.image.sha256 ? 'PASS' : 'FAIL',
      'Capture event image hash vs manifest',
    );
    add(
      'ledger.manifestCopy',
      canonicalize(p.manifest) === canonicalize(manifest) ? 'PASS' : 'FAIL',
      'Manifest file equals manifest embedded in the signed event',
    );
  }
  if (events.length) {
    const chain = verifyChain(events);
    const hard = chain.issues.filter((i) => i.code !== 'SEQUENCE_GAP');
    const gaps = chain.issues.filter((i) => i.code === 'SEQUENCE_GAP');
    if (hard.length)
      add(
        'ledger.chain',
        'FAIL',
        hard.map((i) => `${i.code}@${i.sequence ?? '?'}: ${i.detail}`).join('; '),
      );
    else if (gaps.length)
      add(
        'ledger.chain',
        'INCOMPLETE',
        `${chain.checked} events hash-verified; gaps: ${gaps.map((g) => g.detail).join('; ')}`,
      );
    else
      add(
        'ledger.chain',
        'PASS',
        `${chain.checked} events (seq ${chain.firstSequence}..${chain.lastSequence}) hash-verified and linked`,
      );
  }

  // 4. Device signatures.
  if (pub && events.length) {
    const unsigned = events.filter((e) => !e.deviceSignature);
    const bad = events.filter(
      (e) => e.deviceSignature && !verifyEventSignature(e, pub!.publicKeySpkiBase64),
    );
    if (bad.length)
      add(
        'ledger.signatures',
        'FAIL',
        `${bad.length} signature(s) invalid for the registered device key`,
      );
    else if (unsigned.length)
      add('ledger.signatures', 'INCOMPLETE', `${unsigned.length} event(s) unsigned`);
    else
      add(
        'ledger.signatures',
        'PASS',
        `${events.length} ECDSA-P256 signatures valid for the registered device key (key status at export: ${pub.keyStatus})`,
      );
  }

  // 5. Chain-of-custody audit records.
  try {
    const custody = parseJson<AuditRecord[]>(files[PACKAGE_FILES.custody]);
    if (!custody) add('custody.records', 'INCOMPLETE', 'No custody records included');
    else {
      const bad = custody.filter((r) => computeAuditHash(r) !== r.recordHash);
      add(
        'custody.records',
        bad.length ? 'FAIL' : 'PASS',
        bad.length
          ? `${bad.length} custody record(s) modified`
          : `${custody.length} custody record hashes verified (links verifiable against the full server audit chain only)`,
      );
    }
  } catch {
    add('custody.records', 'FAIL', 'Custody records not parseable');
  }
  return finish();

  function finish(): VerificationReport {
    const status: CheckStatus = checks.some((c) => c.status === 'FAIL')
      ? 'FAIL'
      : checks.some((c) => c.status === 'INCOMPLETE')
        ? 'INCOMPLETE'
        : 'PASS';
    return {
      status,
      evidenceId,
      checkedAt: new Date().toISOString(),
      checks,
      disclaimer: DISCLAIMER,
    };
  }
}

export function verifyPackageZip(zip: Uint8Array): VerificationReport {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    return {
      status: 'FAIL',
      evidenceId: null,
      checkedAt: new Date().toISOString(),
      checks: [{ id: 'zip', status: 'FAIL', detail: 'Not a readable ZIP archive' }],
      disclaimer: DISCLAIMER,
    };
  }
  return verifyPackageFiles(files);
}
