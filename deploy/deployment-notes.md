# Deployment notes

- `render.yaml` — Render Blueprint (database + API web service with persistent disk + static dashboard).
  Use Blueprint path `deploy/render.yaml`. Not executed (no credentials). See the deployment guide, Part D.
- `Dockerfile.api` / `Dockerfile.admin` / `nginx-admin.conf` — container images for `docker compose --profile full`
  or other hosts. **Not built in the authoring environment** (no Docker daemon available).
- Evidence storage is a filesystem path; on Render it must be the persistent disk (`/var/data/evidence`).
  Ephemeral filesystems lose evidence on redeploy.
- Migrations run in the pre-deploy step (`node apps/api/dist/database/migrate-cli.js`) or at start with
  `RUN_MIGRATIONS_ON_START=true`. The runner holds an advisory lock, so concurrent starts are safe.
- The API is single-instance by design (in-process SSE bus; persistent disk prevents horizontal scaling on Render).
