// Summarises vitest JSON reports + logs produced by scripts/run-tests.sh into Markdown.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const suites = [
  ['pkg-event-contracts', 'Shared contracts (canonical JSON, hashing, chain, clock, rules, screen-risk)'],
  ['pkg-validation', 'Validation schemas'],
  ['pkg-verifier', 'Independent evidence-package verifier'],
  ['api', 'Backend API + PostgreSQL/PostGIS integration'],
  ['admin', 'Admin dashboard (React Testing Library)'],
  ['mobile', 'Mobile business logic (ledger, sync, check-ins, evidence)'],
];
let tp = 0, tf = 0, ts = 0;
const lines = ['# PRAMAAN automated test results', '', `Generated: ${new Date().toISOString()} · Node ${process.version} · ${process.platform}`, '', '| Suite | Passed | Failed | Skipped | Describe blocks |', '|---|---:|---:|---:|---:|'];
const details = [];
for (const [k, label] of suites) {
  const f = join(dir, `${k}.json`);
  if (!existsSync(f)) { lines.push(`| ${label} | – | – | – | not run |`); continue; }
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const p = j.numPassedTests, fl = j.numFailedTests, s = (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0);
  tp += p; tf += fl; ts += s;
  lines.push(`| ${label} | ${p} | ${fl} | ${s} | ${j.numTotalTestSuites ?? j.testResults.length} |`);
  details.push(`\n## ${label}\n`);
  for (const r of j.testResults) for (const a of r.assertionResults) details.push(`- ${a.status === 'passed' ? '✅' : a.status === 'failed' ? '❌' : '⏭️'} ${a.ancestorTitles.join(' › ')} › ${a.title}`);
}
const kt = join(dir, 'kotlin-jvm.log');
if (existsSync(kt)) {
  const t = readFileSync(kt, 'utf8');
  const m = /OK \((\d+) tests?\)/.exec(t);
  const fail = /Tests run: (\d+),\s+Failures: (\d+)/.exec(t);
  const p = m ? Number(m[1]) : fail ? Number(fail[1]) - Number(fail[2]) : 0;
  const fl = fail ? Number(fail[2]) : 0;
  tp += p; tf += fl;
  lines.push(`| Kotlin pure-JVM unit tests (CryptoFormat, PostureRules) | ${p} | ${fl} | 0 | 2 |`);
}
lines.push(`| **Total** | **${tp}** | **${tf}** | **${ts}** | |`, '');
lines.push('## Quality gates', '', '| Gate | Result |', '|---|---|');
for (const g of ['lint', 'typecheck-api', 'typecheck-admin', 'typecheck-mobile', 'build-api', 'build-admin']) {
  const f = join(dir, `${g}.exit`);
  if (!existsSync(f)) { lines.push(`| ${g} | not run |`); continue; }
  const rc = readFileSync(f, 'utf8').trim();
  lines.push(`| ${g} | ${rc === '0' ? 'pass (exit 0)' : `FAIL (exit ${rc})`} |`);
}
lines.push('', '## Not executed in this environment', '', '- Android Gradle build (`assembleDebug`/`assembleRelease`) and Android-framework unit/instrumented tests: Android SDK and Google/Maven repositories unavailable.', '- Behaviour on physical Android hardware (biometric prompt, CameraX capture, Keystore/StrongBox, foreground service, alarms, sensors, SQLCipher at runtime).', '- Render deployment (no credentials).', ...details);
console.log(lines.join('\n'));
