# PRAMAAN — Windows Development and Render Deployment Guide

Version 2.0 (railway-police operations upgrade) · 2026-10-15 · Developed by SHAIK GOUSE KAREEM (https://www.linkedin.com/in/gousekareem/)

> Academic prototype. This guide describes how to run and deploy it; it is **not** evidence that a
> deployment exists. Commands were written for Windows 10/11 PowerShell. Steps that were executed in the
> authoring environment (Linux) are marked ✅; steps that could not be executed there are marked ⚠️.

**What changed in 2.0:**
* migrations `0006`–`0007` (applied by `pnpm db:migrate`, upgrade-safe);
* new demo accounts `*@parmaan.demo` (B6a);
* new commands `pnpm db:reset-demo` and `pnpm scenarios`;
* new environment variables `ALLOW_DEMO_LOGIN`, `EXCEPTION_EVALUATOR_INTERVAL_SECONDS` and
  `BACKUP_VERIFICATION_FILE`;
* the local Docker database is published on **host port 5433**, as in your `docker-compose.yml`.

Upgrading an existing installation: B3a.

**Conventions.** `PS C:\src\pramaan>` means *run from the repository root*. Sub-directory prompts are shown
explicitly, e.g. `PS C:\src\pramaan\apps\mobile>`. Always open a **new** PowerShell window after changing
environment variables.

---

## Part A — Windows prerequisites

### A1. Install the tools (winget, from any directory)
```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e           # Node.js LTS ≥ 22.13 (tested: 22.22.0)
winget install --id Microsoft.OpenJDK.17 -e        # JDK 17 — recommended by React Native
winget install --id Google.AndroidStudio -e
winget install --id Docker.DockerDesktop -e        # PostgreSQL+PostGIS container (or see A5)
winget install --id Python.Python.3.12 -e          # only needed to rebuild the PDFs
```
Restart Windows after Docker Desktop installs (it enables WSL 2). Then:
```powershell
corepack enable                                    # activates pnpm 10 pinned in package.json
pnpm --version                                     # expect 10.x
node --version                                     # expect v22.x
java -version                                      # expect 17.x
```
If `corepack enable` fails with a permission error, run PowerShell **as Administrator** once.

### A2. Android Studio SDK components
Android Studio → *More Actions* → *SDK Manager*:
- **SDK Platforms:** Android API **37** (compileSdk) and API **36** (targetSdk).
- **SDK Tools:** Android SDK Build-Tools **37.0.0**, **NDK (Side by side) 27.1.12297006**, CMake,
  Android SDK Platform-Tools, Android SDK Command-line Tools (latest), Android Emulator.
These versions come from `apps/mobile/android/build.gradle`; if your Android Studio offers newer ones,
install the listed versions anyway.

### A3. Environment variables (current user)
```powershell
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
$jdk = (Get-ChildItem 'C:\Program Files\Microsoft\jdk-17*' | Select-Object -First 1).FullName
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk, 'User')
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
[Environment]::SetEnvironmentVariable('Path', "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", 'User')
```
Open a new PowerShell window and check:
```powershell
adb version
echo $env:ANDROID_HOME
echo $env:JAVA_HOME
```

### A4. Android Virtual Device (emulator)
Android Studio → *Device Manager* → *Create Device* → Pixel 8 → system image **API 36 (Google APIs, x86_64)** → Finish → ▶.
```powershell
adb devices                     # emulator-5554   device
```
The emulator reaches your PC's API at `http://10.0.2.2:4000` (already the debug default).

### A5. Physical Android device (USB debugging)
1. Phone: *Settings → About phone →* tap *Build number* 7 times → *Developer options → USB debugging* ON.
2. Connect USB, accept the RSA prompt on the phone.
3. `adb devices` shows the serial with state `device`.
4. To reach the API on your PC from the phone: `adb reverse tcp:4000 tcp:4000`, then build with
   `-PpramaanApiBaseUrl=http://localhost:4000` (debug builds allow cleartext only to localhost/10.0.2.2/127.0.0.1).

**PostgreSQL without Docker (alternative):** install PostgreSQL 16 with the EDB installer, then run
*Stack Builder → Spatial Extensions → PostGIS 3.4 bundle*. Create role/database matching `.env`:
```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE ROLE pramaan LOGIN PASSWORD 'pramaan_dev_only' CREATEDB;" -c "CREATE DATABASE pramaan OWNER pramaan;"
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -d pramaan -c "CREATE EXTENSION postgis;"
```
(The migration also runs `CREATE EXTENSION IF NOT EXISTS postgis`, which needs owner/superuser rights.)

---

## Part B — Get the project and run it locally

### B1. Extract
```powershell
New-Item -ItemType Directory -Force C:\src | Out-Null
Expand-Archive -Path "$HOME\Downloads\PRAMAAN_COMPLETE_PROJECT.zip" -DestinationPath C:\src
Set-Location C:\src\pramaan
```
Keep the path short (`C:\src\pramaan`) — Windows path-length limits break Android/CMake builds in deep folders.

### B2. One-command setup ✅ (Linux equivalent executed)
```powershell
PS C:\src\pramaan> powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```
The script: verifies tools (`scripts\verify-environment.ps1`), creates `.env` from `.env.example` with a
fresh random `JWT_ACCESS_SECRET`, runs `pnpm install --frozen-lockfile`, builds the shared packages, runs
`npm ci` for the mobile app, starts the database (`docker compose up -d db`), waits for readiness, applies
migrations and seeds the **synthetic** demo data. Options: `-SkipDocker` (own PostgreSQL), `-SkipMobile`.

### B3. The same steps manually
```powershell
PS C:\src\pramaan> Copy-Item .env.example .env
PS C:\src\pramaan> node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#   → paste the output as JWT_ACCESS_SECRET=... in .env (notepad .env)
PS C:\src\pramaan> corepack enable                       # or use the bundled .\pnpm.cmd wrapper (corepack pnpm@10.28.0)
PS C:\src\pramaan> pnpm install --frozen-lockfile
PS C:\src\pramaan> pnpm run build:packages
PS C:\src\pramaan> docker compose up -d db
PS C:\src\pramaan> docker compose ps                     # pramaan-db ... (healthy)
PS C:\src\pramaan> pnpm db:migrate                        # applies database\migrations\0001..0007
PS C:\src\pramaan> pnpm db:seed                           # synthetic DEMO data (needs ALLOW_DEMO_SEED=true); prints the demo logins
```
**Demo-data reset (development only — drops ALL PRAMAAN tables):**
```powershell
PS C:\src\pramaan> pnpm db:reset-demo                                        # = pnpm db:seed -- --reset
PS C:\src\pramaan> pnpm db:seed -- --reset --reference-date 2026-10-15        # reproducible dataset for that IST date
```
The generator is deterministic. With the same reference date it produces the same personnel, units, duties,
instructions, handover and unavailability. Without one, “today” in Asia/Kolkata is used. Never run a reset
against a database holding real data.

### B3a. Upgrading an existing PRAMAAN 1.0 installation ✅ (executed on the 1.0 demo database)
```powershell
PS C:\src\pramaan> # 1. stop the API (Ctrl+C in its window) and take a backup (B10)
PS C:\src\pramaan> pnpm install --frozen-lockfile
PS C:\src\pramaan> pnpm run build:packages
PS C:\src\pramaan> pnpm db:migrate        # applies only 0006_rbac_personnel.sql and 0007_duty_operations.sql
PS C:\src\pramaan> pnpm db:verify-audit   # must print "ok": true — existing audit history is untouched
PS C:\src\pramaan> pnpm db:seed           # optional (demo DBs only): adds units, personnel, rank accounts and duties
PS C:\src\pramaan> pnpm dev:api
```
Existing ranks are mapped (`CONSTABLE → PC`, `HEAD_CONSTABLE → HC`, `INSPECTOR → CI`). Existing accounts keep
their roles and behaviour, and devices, events, evidence and flags are unchanged. Personnel without a unit
are visible only to global roles until an administrator assigns a unit.

### B4. Environment variables (`.env`, API)
| Variable | Development value | Production (Render) |
|---|---|---|
| `NODE_ENV` | development | production |
| `PORT` / `HOST` | 4000 / 0.0.0.0 | set by Render / 0.0.0.0 |
| `DATABASE_URL` | `postgres://pramaan:pramaan_dev_only@localhost:5433/pramaan` | Render **internal** connection string |
| `DATABASE_SSL_MODE` | disable | disable (private network) or verify-full (external URL + CA) |
| `JWT_ACCESS_SECRET` | random 48 bytes | `generateValue` (≥ 32 chars, no placeholder words) |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | 900 / 7 | same |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | exact dashboard origin, e.g. `https://pramaan-admin.onrender.com` |
| `COOKIE_SAMESITE` | strict | **none** (dashboard and API are different sites on `onrender.com`) |
| `TRUST_PROXY` | 0 | 1 |
| `EVIDENCE_STORAGE_DIR` | `./storage/evidence` | `/var/data/evidence` (persistent disk) |
| `MAX_EVIDENCE_BYTES` / `MAX_JSON_BODY_BYTES` | 8388608 / 2097152 | same |
| `RATE_LIMIT_*` | 600 / 10 / 120 | same or stricter |
| `RUN_MIGRATIONS_ON_START` | false | false when a pre-deploy command is used; true otherwise |
| `ALLOW_DEMO_SEED` / `SEED_DEMO_PASSWORD` | true / dev-only password (PRAMAAN 1.0 demo accounts) | **false** / unset |
| `ALLOW_DEMO_LOGIN` | unset (= allowed outside production) | **unset or false**. `true` lets demo accounts sign in; logged as an explicit decision |
| `EXCEPTION_EVALUATOR_INTERVAL_SECONDS` | 60 | 60 (0 disables the timer) |
| `BACKUP_VERIFICATION_FILE` | optional, e.g. `./backups/backup-verification.json` | path on the persistent disk, if drills are run there |
| `TEST_DATABASE_ADMIN_URL` | `postgres://pramaan:pramaan_dev_only@localhost:5433/postgres` | — |

Dashboard (`apps\admin\.env.local`, public — never secrets): `VITE_API_BASE_URL`, `VITE_MAP_TILE_URL`,
`VITE_MAP_ATTRIBUTION`. Mobile: Gradle property `pramaanApiBaseUrl` (see B8).

### B5. Start the backend ✅
```powershell
PS C:\src\pramaan> pnpm dev:api
# new window:
PS C:\src\pramaan> .\scripts\check-health.ps1 -ApiUrl http://localhost:4000
#   /health  HTTP 200  {"status":"ok",...}
#   /ready   HTTP 200  {"status":"ready","checks":{"database":"ok","postgis":"3.4.x","migrations":"7","storage":"ok"}}
```
Production-style run: `pnpm --filter @pramaan/api build` then `node apps\api\dist\server.js`.

### B6. Start the dashboard ✅
```powershell
PS C:\src\pramaan> pnpm dev:admin                  # http://localhost:5173
```
Sign in with one of the rank demonstration accounts. The navigation adapts to each account's permissions.

### B6a. Demonstration accounts (local / test environments only)
| Role | Login | Password | Lands on |
|---|---|---|---|
| HG — Home Guard | `hg@parmaan.demo` | `hg-parmaan.demo` | My duties |
| PC — General Constable | `pc@parmaan.demo` | `pc-parmaan.demo` | My duties |
| PC — AR Constable | `pc.ar@parmaan.demo` | `pc.ar-parmaan.demo` | My duties |
| HC — Head Constable | `hc@parmaan.demo` | `hc-parmaan.demo` | Overview (station) |
| ASI — Assistant Sub-Inspector | `asi@parmaan.demo` | `asi-parmaan.demo` | Overview (station) |
| SI — Sub-Inspector | `si@parmaan.demo` | `si-parmaan.demo` | Overview (station) |
| CI — Circle Inspector | `ci@parmaan.demo` | `ci-parmaan.demo` | Overview (circle) |
| DSP — Deputy Superintendent of Police | `dsp@parmaan.demo` | `dsp-parmaan.demo` | Overview (sub-division) |
| System administrator (additional; not a rank) | `admin@parmaan.demo` | `admin-parmaan.demo` | Overview + administration |

The PRAMAAN 1.0 accounts (`admin|supervisor|reviewer@pramaan.demo` on the web, `officer1|officer2@pramaan.demo` on
the device only) still work with `SEED_DEMO_PASSWORD`. These credentials are for local demonstrations only.
Production refuses demo seeding and demo logins (see B4). A per-rank walkthrough and a five-minute script are in
`docs\demo-script.md`.

### B7. Simulated end-to-end demo (no phone needed) ✅
```powershell
PS C:\src\pramaan> pnpm simulate -- --api http://localhost:4000 --password Demo-Only-Passw0rd --out .\out\demo
PS C:\src\pramaan> node packages\verifier\dist\cli.js (Get-ChildItem .\out\demo\sample-evidence-package-*.zip | Where-Object Name -notlike '*TAMPERED*').FullName
PS C:\src\pramaan> node packages\verifier\dist\cli.js .\out\demo\sample-evidence-package-TAMPERED.zip   # RESULT: FAIL
```

### B7a. Scenario demonstration (simulated devices) ✅
```powershell
PS C:\src\pramaan> pnpm db:reset-demo
PS C:\src\pramaan> pnpm dev:api                 # restart the API after a reset
PS C:\src\pramaan> pnpm scenarios -- --api http://localhost:4000 --out .\out\scenarios
```
42 checks: four categories, train beat with check-ins and a missed check-in, station watch with offline sync,
replay and duplicates, overlapping assignment, inactive personnel, VIP restriction, incident evidence and
tampering, unauthorised access, exception review, audited correction, reports and audit chain. Output:
`out\scenarios\scenarios-run.json`, report PDFs and an evidence package. Devices are simulated.

### B8. Build and run the Android app ⚠️ (not executed in the authoring environment)
```powershell
PS C:\src\pramaan\apps\mobile> npm ci
PS C:\src\pramaan\apps\mobile> npx react-native start                 # Metro, keep running
# second window:
PS C:\src\pramaan\apps\mobile> npx react-native run-android           # debug build → emulator / device
```
Debug APK only:
```powershell
PS C:\src\pramaan\apps\mobile\android> .\gradlew.bat assembleDebug
PS C:\src\pramaan\apps\mobile\android> adb install -r app\build\outputs\apk\debug\app-debug.apk
```
Point the app at another API (e.g. a phone using `adb reverse`):
```powershell
PS C:\src\pramaan\apps\mobile\android> .\gradlew.bat assembleDebug -PpramaanApiBaseUrl=http://localhost:4000
```
SQLCipher is enabled by `"op-sqlite": { "sqlcipher": true }` in `apps\mobile\package.json`. If the native
build was produced without it, the app refuses to start ("Cannot start securely") — it never falls back to
plaintext. After changing that setting run `.\gradlew.bat clean` and rebuild.

### B9. Run the tests ✅
```powershell
PS C:\src\pramaan> docker compose up -d db
PS C:\src\pramaan> powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1
PS C:\src\pramaan> Get-Content .\out\test-results\SUMMARY.md
```
Individually:
```powershell
PS C:\src\pramaan> pnpm test                                    # packages + API + dashboard
PS C:\src\pramaan> pnpm --filter @pramaan/api test              # backend + PostGIS integration
PS C:\src\pramaan> pnpm --filter @pramaan/admin test            # dashboard
PS C:\src\pramaan\apps\mobile> npx vitest run                   # mobile business logic
PS C:\src\pramaan\apps\mobile\android> .\gradlew.bat testDebugUnitTest   # Kotlin unit tests ⚠️
PS C:\src\pramaan> pnpm lint ; pnpm typecheck ; pnpm audit:deps
```
Physical-device verification: follow `docs\device-test-checklist.md`.

### B10. Backup and restore drill
```powershell
PS C:\src\pramaan> New-Item -ItemType Directory -Force backups | Out-Null
PS C:\src\pramaan> docker compose exec -T db pg_dump -U pramaan -Fc -f /tmp/pramaan.dump pramaan
PS C:\src\pramaan> docker compose cp db:/tmp/pramaan.dump .\backups\pramaan.dump
PS C:\src\pramaan> Get-FileHash .\backups\pramaan.dump -Algorithm SHA256
PS C:\src\pramaan> docker compose exec -T db psql -U pramaan -d postgres -c "DROP DATABASE IF EXISTS pramaan_restore_check" -c "CREATE DATABASE pramaan_restore_check"
PS C:\src\pramaan> docker compose exec -T db pg_restore -U pramaan -d pramaan_restore_check --no-owner --exit-on-error /tmp/pramaan.dump
PS C:\src\pramaan> $env:DATABASE_URL='postgres://pramaan:pramaan_dev_only@localhost:5433/pramaan_restore_check'; pnpm db:verify-audit; Remove-Item Env:DATABASE_URL
```
`db:verify-audit` must print `"ok": true`. On Linux/macOS/WSL/Git Bash use `scripts/backup-restore-check.sh`,
which also compares row counts (including the 2.0 duty tables) and checks every evidence reference ✅ (result:
`docs/results/backup-restore-check.txt`):
```bash
SOURCE_URL=postgres://pramaan:pramaan_dev_only@localhost:5433/pramaan \
ADMIN_URL=postgres://pramaan:pramaan_dev_only@localhost:5433/postgres \
EVIDENCE_DIR=apps/api/storage/evidence OUT=./backups bash scripts/backup-restore-check.sh
```
It writes `backups/backup-verification.json` (`"passed": true|false`). Set `BACKUP_VERIFICATION_FILE` to that
path and restart the API: **System status** then shows the last drill result. Without that file the page shows
“not available”. `EVIDENCE_DIR` must be the API's `EVIDENCE_STORAGE_DIR`; a wrong path is reported as missing
objects and the drill fails, which is intended.

### B11. Troubleshooting
| Symptom | Fix |
|---|---|
| `pnpm` not found | `corepack enable` (Administrator PowerShell once) |
| `ECONNREFUSED 127.0.0.1:5433` | `docker compose up -d db`; check Docker Desktop is running |
| Migration error `extension "postgis" is not available` | Use the `postgis/postgis` image or install the PostGIS bundle; plain PostgreSQL lacks it |
| `Invalid configuration: JWT_ACCESS_SECRET` | Must be ≥ 32 characters |
| Dashboard shows "Server unreachable" | API not running, wrong `VITE_API_BASE_URL`, or origin missing from `CORS_ORIGINS` |
| Login works but refresh fails after reload in production | `COOKIE_SAMESITE=none` and HTTPS are required when dashboard and API are on different sites |
| `SDK location not found` | Set `ANDROID_HOME`, or create `apps\mobile\android\local.properties` with `sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk` |
| `Unsupported class file major version` | Use JDK 17 (`JAVA_HOME`) |
| NDK / CMake errors, "filename longer than 260 characters" | Install NDK 27.1.12297006; move repo to `C:\src\pramaan`; `git config --system core.longpaths true` |
| op-sqlite / SQLCipher compile errors | `cd apps\mobile\android; .\gradlew.bat clean`, delete `apps\mobile\android\app\.cxx`, rebuild |
| Metro: `Unable to resolve module @pramaan/event-contracts` | Run from `apps\mobile` (metro.config.js maps the shared packages); `npx react-native start --reset-cache` |
| `Export namespace should be first transformed` | `npm ci` in `apps\mobile` (installs `@babel/plugin-transform-export-namespace-from`) |
| `migrations` shows 5 / new pages return 404 from the API | `pnpm db:migrate` was not run after upgrading (B3a) |
| `Migration 0007_… was modified after being applied` | A pre-release copy of 0007 was applied to this database; on a demo DB run `pnpm db:reset-demo` |
| Rank account login → “Invalid email or password” in production | Expected: demo accounts are refused unless `ALLOW_DEMO_LOGIN=true` (not recommended) |
| “Not authorised to open this page” or 404 for another unit's record | Expected permission/scope behaviour; check the account's role on **Account & sessions** |
| Roster/duties empty for a supervisor | The account's personnel record has no unit or the unit tree is incomplete (Personnel → Edit record) |
| `password authentication failed` / `ECONNREFUSED …:5432` | The Docker database is on host port **5433**; use the `.env.example` URLs |
| Check-ins arrive late | Allow exact alarms and exclude PRAMAAN from battery optimisation (Settings screen); OEM limits remain |

---

## Part C — Git and GitHub
```powershell
PS C:\src\pramaan> git init -b main
PS C:\src\pramaan> git add .
PS C:\src\pramaan> git status            # confirm .env, node_modules, storage, *.dump are NOT listed
PS C:\src\pramaan> git commit -m "PRAMAAN capstone prototype"
# create an EMPTY private repository on github.com (no README), then:
PS C:\src\pramaan> git remote add origin https://github.com/<your-account>/pramaan.git
PS C:\src\pramaan> git push -u origin main
```
`.gitignore` excludes `.env`, `node_modules`, builds, evidence storage, keystores and dumps. The CI workflow
`.github/workflows/ci.yml` runs lint, type checks, tests against a PostGIS service container, builds and
the mobile JS checks; an Android job runs `gradlew testDebugUnitTest assembleDebug` on GitHub runners ⚠️.

---

## Part D — Render deployment ⚠️ (configuration provided; not executed — no account credentials)

### D1. PostGIS on Render
Render's documentation lists `postgis` as a supported extension for Render Postgres (PostgreSQL 13 and
later: enable it with `CREATE EXTENSION postgis;`). PRAMAAN's first migration runs
`CREATE EXTENSION IF NOT EXISTS postgis` and fails loudly if it is unavailable — spatial functionality is
never silently dropped. Verify on your instance after creation:
```powershell
psql "<External Database URL>" -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT postgis_full_version();"
```
If a plan or provider ever lacks PostGIS, use a PostgreSQL host that offers it (e.g. a managed provider
with PostGIS support) and set `DATABASE_URL` + `DATABASE_SSL_MODE=verify-full`.

### D2. Option 1 — Blueprint (recommended)
1. Push the repository to GitHub (Part C).
2. Render Dashboard → **New → Blueprint** → select the repository → set **Blueprint path** to
   `deploy/render.yaml` → review the three resources (`pramaan-db`, `pramaan-api`, `pramaan-admin`).
3. Enter the prompted values:
   - `CORS_ORIGINS` = `https://pramaan-admin.onrender.com` (your static site URL)
   - `VITE_API_BASE_URL` = `https://pramaan-api.onrender.com` (your API URL)
4. Choose instance types. **The API needs a paid instance type for the persistent disk** (`/var/data`,
   5 GB) — without a disk, uploaded evidence is lost on every redeploy/restart. Also note that free
   Render Postgres instances expire; use a paid database for anything beyond a short demo. Check current
   pricing on render.com.
5. Apply. Render builds the API with
   `corepack enable && pnpm install --frozen-lockfile --prod=false --filter "@pramaan/api..." && pnpm -r --filter "./packages/*" run build && pnpm --filter @pramaan/api run build`,
   runs `node apps/api/dist/database/migrate-cli.js` as the **pre-deploy command**, then starts
   `node apps/api/dist/server.js` (binds to Render's `PORT`), health check `/health`.

### D3. Option 2 — Manual services (same settings)
**Database:** New → PostgreSQL → name `pramaan-db`, region **Singapore** (closest to India), version 16.
Copy the *Internal Database URL*.

**API:** New → Web Service → repo → Runtime **Node** → Root directory: *(leave empty — repository root)*.
| Setting | Value |
|---|---|
| Build command | `corepack enable && pnpm install --frozen-lockfile --prod=false --filter "@pramaan/api..." && pnpm -r --filter "./packages/*" run build && pnpm --filter @pramaan/api run build` |
| Pre-deploy command | `node apps/api/dist/database/migrate-cli.js` (if unavailable on your plan: set `RUN_MIGRATIONS_ON_START=true`) |
| Start command | `node apps/api/dist/server.js` |
| Health check path | `/health` |
| Disk | mount path `/var/data`, 5 GB |
| Environment | `NODE_ENV=production`, `NODE_VERSION=22.22.0`, `DATABASE_URL=<internal URL>`, `DATABASE_SSL_MODE=disable`, `JWT_ACCESS_SECRET=<generate>`, `CORS_ORIGINS=https://<admin>.onrender.com`, `COOKIE_SAMESITE=none`, `TRUST_PROXY=1`, `EVIDENCE_STORAGE_DIR=/var/data/evidence`, `ALLOW_DEMO_SEED=false` |

The API refuses to start in production with a placeholder secret, `*`/localhost CORS, demo seeding enabled,
or insecure cookies.

**Dashboard:** New → Static Site → repo.
| Setting | Value |
|---|---|
| Build command | `corepack enable && pnpm install --frozen-lockfile --prod=false --filter "@pramaan/admin..." && pnpm --filter @pramaan/admin run build` |
| Publish directory | `apps/admin/dist` |
| Environment | `VITE_API_BASE_URL=https://<api>.onrender.com`, `NODE_VERSION=22.22.0`, optional `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` |
| Redirects/Rewrites | Rewrite `/*` → `/index.html` (browser routing fallback) |
| Headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |

Map tiles: the default OpenStreetMap tile server is for light use only (OSM tile usage policy). For more
than a demo, configure a commercial/self-hosted tile provider via `VITE_MAP_TILE_URL`.

### D4. Create the first real administrator (no demo accounts in production)
From your PC, using the Render **External** database URL (temporarily allow your IP in the database's
access control list), run the user-creation tool. The password is read from an environment variable so it
does not appear in shell history files; it must satisfy the password policy (≥ 12 chars, upper, lower, digit).
```powershell
PS C:\src\pramaan> pnpm --filter @pramaan/api build
PS C:\src\pramaan> $env:DATABASE_URL='<External Database URL>'; $env:DATABASE_SSL_MODE='verify-full'
PS C:\src\pramaan> $env:PRAMAAN_NEW_PASSWORD = Read-Host 'New admin password'
PS C:\src\pramaan> node apps\api\dist\tools\create-user.js --email admin@your-unit.example --name "System Administrator" --role ADMIN
PS C:\src\pramaan> Remove-Item Env:PRAMAAN_NEW_PASSWORD, Env:DATABASE_URL, Env:DATABASE_SSL_MODE
```
Create units and personnel records in the dashboard as this administrator (Personnel → Add personnel). Then
create the rank accounts on **Login accounts**, or with the CLI:
`--role SI --personnel-ref GRP-SI-0001` (link to an existing record), or
`--role PC --personnel-ref GRP-PC-0002 --create-personnel --rank PC --constable-category AR --unit-code ST-01`.
Home Guards use `--personnel-category HOME_GUARD` with no rank. Remove your IP from the allow-list
afterwards. Review the default role permissions and duty-category policy (**Duty policy & roles**) with the
department **before** creating real accounts.

### D5. Health checks and logs
```powershell
PS C:\src\pramaan> .\scripts\check-health.ps1 -ApiUrl https://pramaan-api.onrender.com
```
Render Dashboard → `pramaan-api` → **Logs**: structured JSON (pino); `authorization`, cookies, passwords and
tokens are redacted. Look for `PRAMAAN API listening` and migration output from the pre-deploy step.

### D6. Android build for the deployed backend ⚠️
```powershell
PS C:\src\pramaan\apps\mobile\android> keytool -genkeypair -v -keystore pramaan-release.jks -alias pramaan -keyalg RSA -keysize 4096 -validity 3650
PS C:\src\pramaan\apps\mobile\android> @"
storeFile=../pramaan-release.jks
storePassword=<store password>
keyAlias=pramaan
keyPassword=<key password>
"@ | Set-Content keystore.properties
PS C:\src\pramaan\apps\mobile\android> .\gradlew.bat assembleRelease -PpramaanApiBaseUrl=https://pramaan-api.onrender.com
PS C:\src\pramaan\apps\mobile\android> adb install -r app\build\outputs\apk\release\app-release.apk
```
Release builds **fail** unless the API URL is HTTPS; cleartext is blocked by the release network security
config. `keystore.properties` and `*.jks` are git-ignored — back them up securely; losing the key means
users must reinstall. Bump `versionCode`/`versionName` in `apps\mobile\android\app\build.gradle` for each
release. Permissions requested at runtime: camera, fine location, activity recognition, notifications;
exact alarms and battery-optimisation exemption are user-granted in Settings. No server credentials are
embedded in the APK — only the public API URL.

### D7. Backups, retention and failed deployments
- Enable/confirm Render Postgres automated backups (availability and retention depend on plan) and
  periodically run the restore drill (B10) against a copy.
- Back up the evidence disk separately (Render disk snapshots, or copy `/var/data/evidence` with the Render
  shell). Database and evidence backups must be from the same point in time for a consistent restore.
- Failed deployment: Render keeps the previous version running if the build or pre-deploy step fails. If a
  deployed version misbehaves, use **Rollback** in the service's *Events* tab. Migrations are forward-only:
  fix a bad migration with a new migration; restore from backup only if data was damaged.

---

## Part E — Production-readiness checklist
| # | Item | How to verify |
|---|---|---|
| 1 | Migrations applied | `/ready` → `"migrations":"7"` |
| 2 | PostGIS present | `/ready` → `"postgis":"3.x"` |
| 3 | Database backups configured | Render database → Backups |
| 4 | Admin password changed / strong | first admin created per D4; no `@pramaan.demo` accounts exist (`SELECT count(*) FROM app_users WHERE is_demo`) = 0 |
| 5 | Demo seeding and demo logins disabled | `ALLOW_DEMO_SEED=false` (API refuses to start otherwise); `ALLOW_DEMO_LOGIN` unset/false; System status → “Demo accounts can sign in: no”; `SELECT count(*) FROM app_users WHERE is_demo` = 0 |
| 6 | TLS verified | `https://` URLs; HSTS header present |
| 7 | CORS restricted | `CORS_ORIGINS` = dashboard origin only |
| 8 | Secrets configured | `JWT_ACCESS_SECRET` generated; no secrets in `VITE_*` |
| 9 | Authentication enabled | unauthenticated `GET /api/v1/officers` → 401 |
| 10 | Evidence storage persistent | disk mounted at `/var/data`; upload, redeploy, re-download works |
| 11 | Upload limits verified | 9 MB upload → 413 |
| 12 | Logs free of sensitive data | inspect Render logs after a sync and an export |
| 13 | Dashboard access controlled | reviewer cannot open images or audit page |
| 14 | Health endpoints | `check-health.ps1` both 200 |
| 15 | Android release build installed and tested | device checklist completed on target phones |
| 16 | Sync tested against the deployed service | offline → online on a real device; dashboard shows delayed sync |
| 17 | Legal/organisational approval | outside the software — required before real use |
| 18 | Role permissions, scopes, eligibility and check-in policy validated by the department | Duty policy & roles page reviewed and changed as required; record the decision |
| 19 | Unit tree and personnel units correct | every supervisor's scope shows only their units (log in and check Personnel) |
| 20 | Backup drill recorded | System status → Backup verification “verified” with a recent date |
