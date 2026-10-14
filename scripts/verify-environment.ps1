<#
.SYNOPSIS  Checks the tools PRAMAAN needs on Windows and prints their versions.
#>
param([switch]$Quiet)
$fail = 0
function Check($name, $cmd, $versionArgs, [switch]$Optional) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if (-not $c) {
    if ($Optional) { Write-Host ("[optional] {0,-14} not found" -f $name) -ForegroundColor Yellow }
    else { Write-Host ("[MISSING]  {0,-14} not found" -f $name) -ForegroundColor Red; $script:fail++ }
    return
  }
  if ($name -eq 'Java (JDK 17)') {
  $v = (& $cmd @versionArgs 2>&1 | ForEach-Object { "$_" } | Select-Object -First 1)
} else {
  $v = (& $cmd @versionArgs 2>&1 | Select-Object -First 1)
}
  $global:LASTEXITCODE = 0
  Write-Host ("[ok]       {0,-14} {1}" -f $name, $v) -ForegroundColor Green
}
Check 'Git' git @('--version')
Check 'Node.js' node @('--version')
Check 'pnpm' pnpm @('--version') -Optional
Check 'Docker' docker @('--version') -Optional
# Check 'Java (JDK 17)' java @('-version') -Optional
Check 'adb' adb @('version') -Optional
$nodeMajor = [int]((node --version) -replace '^v(\d+).*','$1')
if ($nodeMajor -lt 22) { Write-Host 'Node.js 22 LTS or newer is required.' -ForegroundColor Red; $fail++ }
if ($env:ANDROID_HOME) { Write-Host "ANDROID_HOME = $env:ANDROID_HOME" } else { Write-Host 'ANDROID_HOME not set (needed only for the Android app).' -ForegroundColor Yellow }
if ($env:JAVA_HOME) { Write-Host "JAVA_HOME    = $env:JAVA_HOME" }
if ($fail -gt 0) { exit 1 } else { if (-not $Quiet) { Write-Host 'Environment OK.' -ForegroundColor Green }; exit 0 }
