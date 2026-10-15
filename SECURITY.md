# Security policy

PRAMAAN is an academic prototype. Do not use it for real police operations without an independent
security assessment and organisational/legal approval.

## Reporting a vulnerability
Contact the developer privately via https://www.linkedin.com/in/gousekareem/ with a description and
reproduction steps. Please do not open public issues for vulnerabilities and do not test against
deployments you do not own.

## Scope and design documents
- Security model: `docs/security-model.md`
- Threat matrix (46 threats incl. 2.0 authorisation/operations threats, residual ratings): `docs/threat-matrix.md`
- Known limitations: `docs/limitations.md`

## Secrets
Never commit `.env`, keystores (`*.jks`, `keystore.properties`), database dumps or evidence files. The
repository's `.gitignore` excludes them; `.env.example` contains placeholders only.
