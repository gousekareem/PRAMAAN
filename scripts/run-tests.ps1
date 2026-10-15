<#
.SYNOPSIS  Runs lint, type checks, all automated test suites and builds; writes out\test-results\SUMMARY.md.
.NOTES     Requires the database: docker compose up -d db
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not $env:TEST_DATABASE_ADMIN_URL) { $env:TEST_DATABASE_ADMIN_URL = 'postgres://pramaan:pramaan_dev_only@localhost:5433/postgres' }
$Out = Join-Path $Root 'out\test-results'
New-Item -ItemType Directory -Force $Out | Out-Null
$failed = @()
function Run($name, $dir, [scriptblock]$block) {
  Write-Host "== $name" -ForegroundColor Cyan
  Push-Location $dir
  & $block *> (Join-Path $Out "$name.log")
  $rc = $LASTEXITCODE
  Pop-Location
  Set-Content -Path (Join-Path $Out "$name.exit") -Value $rc
  if ($rc -ne 0) { $script:failed += $name; Write-Host "   FAILED (exit $rc) - see out\test-results\$name.log" -ForegroundColor Red } else { Write-Host '   ok' -ForegroundColor Green }
}
pnpm run build:packages | Out-Null
foreach ($p in 'event-contracts','validation','verifier') { Run "pkg-$p" "packages\$p" { npx vitest run --reporter=default --reporter=json --outputFile="$Out\pkg-$p.json" } }
Run 'api' 'apps\api' { npx vitest run --reporter=default --reporter=json --outputFile="$Out\api.json" }
Run 'admin' 'apps\admin' { npx vitest run --reporter=default --reporter=json --outputFile="$Out\admin.json" }
Run 'mobile' 'apps\mobile' { npx vitest run --reporter=default --reporter=json --outputFile="$Out\mobile.json" }
Run 'lint' '.' { npx eslint . }
Run 'typecheck-api' 'apps\api' { npx tsc -p tsconfig.json --noEmit }
Run 'typecheck-admin' 'apps\admin' { npx tsc -p tsconfig.json --noEmit }
Run 'typecheck-mobile' 'apps\mobile' { npx tsc -p tsconfig.json --noEmit }
Run 'build-api' 'apps\api' { pnpm run build }
Run 'build-admin' 'apps\admin' { pnpm run build }
node scripts\summarize-test-results.mjs $Out | Set-Content -Encoding UTF8 (Join-Path $Out 'SUMMARY.md')
Get-Content (Join-Path $Out 'SUMMARY.md') -TotalCount 25
if ($failed.Count -gt 0) { Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
