#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { verifyPackageZip } from './verify';

/**
 * Usage: pramaan-verify <evidence-package.zip> [--json]
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = INCOMPLETE, 3 = usage / I/O error.
 * Works fully offline and independently of the dashboard and API.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  process.stderr.write('Usage: pramaan-verify <evidence-package.zip> [--json]\n');
  process.exit(3);
}
let bytes: Buffer;
try {
  if (statSync(file).size > 64 * 1024 * 1024) throw new Error('Package larger than 64 MiB');
  bytes = readFileSync(file);
} catch (e) {
  process.stderr.write(`Cannot read package: ${(e as Error).message}\n`);
  process.exit(3);
}
const report = verifyPackageZip(new Uint8Array(bytes));
if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(
    `PRAMAAN evidence package verification\nPackage : ${file}\nEvidence: ${report.evidenceId ?? 'unknown'}\n\n`,
  );
  for (const c of report.checks)
    process.stdout.write(`[${c.status.padEnd(10)}] ${c.id}\n             ${c.detail}\n`);
  process.stdout.write(`\nRESULT: ${report.status}\n\n${report.disclaimer}\n`);
}
process.exit(report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2);
