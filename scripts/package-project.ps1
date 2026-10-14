<#
.SYNOPSIS  Packages the source repository (no node_modules, builds, secrets) into a ZIP with a single pramaan\ root.
.EXAMPLE   .\scripts\package-project.ps1 -Output ..\PRAMAAN_COMPLETE_PROJECT.zip
#>
param([string]$Output = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'PRAMAAN_COMPLETE_PROJECT.zip'))
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Stage = Join-Path ([IO.Path]::GetTempPath()) ("pramaan-pkg-" + [Guid]::NewGuid())
$Dest = Join-Path $Stage 'pramaan'
# Runtime data folders are excluded by full path only, so source folders such as apps\mobile\src\storage are kept.
$exclude = @('node_modules', 'dist', 'build', 'coverage', '.gradle', '.cxx', '.idea', '.vscode',
  (Join-Path $Root 'out'), (Join-Path $Root 'storage'), (Join-Path $Root 'backups'),
  (Join-Path $Root 'apps\api\storage'), (Join-Path $Root 'apps\api\backups'))
robocopy $Root $Dest /E /XD $exclude /XF '.env' '*.log' '*.dump' 'keystore.properties' '*.jks' '*.tsbuildinfo' /NFL /NDL /NJH /NJS | Out-Null
foreach ($f in 'apps\mobile\src\storage\db.ts', 'apps\api\src\server.ts', 'apps\admin\src\components\layout\AppFooter.tsx', 'packages\event-contracts\src\index.ts') {
  if (-not (Test-Path (Join-Path $Dest $f))) { throw "Missing essential file: $f" }
}
Push-Location $Dest
Get-ChildItem -Recurse -File | Where-Object Name -ne 'MANIFEST.sha256' | Sort-Object FullName | ForEach-Object {
  '{0}  ./{1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), (Resolve-Path -Relative $_.FullName).Substring(2).Replace('\','/')
} | Set-Content -Encoding ASCII MANIFEST.sha256
Pop-Location
if (Test-Path $Output) { Remove-Item $Output }
Compress-Archive -Path $Dest -DestinationPath $Output -CompressionLevel Optimal
Remove-Item -Recurse -Force $Stage
$h = (Get-FileHash $Output -Algorithm SHA256).Hash.ToLower()
Write-Host "Created $Output`nSHA-256 $h"
