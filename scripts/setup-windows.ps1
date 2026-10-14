<#
.SYNOPSIS  One-time local setup for PRAMAAN on Windows 10/11 (run from the repository root).
.EXAMPLE   powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
#>
[CmdletBinding()]
param([switch]$SkipDocker, [switch]$SkipMobile)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

& "$PSScriptRoot\verify-environment.ps1" -Quiet
if ($LASTEXITCODE -ne 0) { throw 'Fix the missing prerequisites listed above, then re-run.' }

if (-not (Test-Path '.env')) {
  $secret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  (Get-Content '.env.example') -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$secret" | Set-Content -Encoding UTF8 '.env'
  Write-Host 'Created .env with a freshly generated development JWT secret.' -ForegroundColor Green
} else { Write-Host '.env already exists - left unchanged.' }

Write-Host 'Installing workspace dependencies (pnpm)...'
corepack pnpm@10.28.0 install --frozen-lockfile
corepack pnpm@10.28.0 run build:packages

if (-not $SkipMobile) {
  Write-Host 'Installing mobile dependencies (npm)...'
  Push-Location apps\mobile; npm ci; Pop-Location
}

if (-not $SkipDocker) {
  Write-Host 'Starting PostgreSQL + PostGIS (Docker)...'
  docker compose up -d db
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    docker compose exec -T db pg_isready -U pramaan -d pramaan *> $null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ok) { throw 'Database did not become ready.' }
}

Write-Host 'Applying migrations and seeding SYNTHETIC demo data...'
corepack pnpm@10.28.0 db:seed
Write-Host "`nSetup complete. Next: 'pnpm dev:api' and (new window) 'pnpm dev:admin'." -ForegroundColor Green
