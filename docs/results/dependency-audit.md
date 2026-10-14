# Dependency vulnerability review (2026-10-13T06:21Z)

## pnpm workspace (API, dashboard, shared packages) — `pnpm audit --prod`
```
No known vulnerabilities found
```

Fixed during this build: react-router-dom 7.9.4 → 7.18.4 and express-rate-limit 8.1.0 → 8.7.1 (pulls patched ip-address).

## Mobile (npm) — `npm audit --omit=dev`
```
22 vulnerabilities (1 low, 21 high)
```

Residual: all mobile findings trace to braces/micromatch (ReDoS) inside Metro and the React Native CLI and a low-severity @babel/core issue. These are developer build-time tools; they are not packaged into the APK runtime. The latest published braces (3.0.3) and micromatch (4.0.8) are already installed, so no patched version exists at the time of this review; npm's suggested 'fix' would downgrade React Native to 0.72 and is not applied. Re-run the audit before any real deployment.
