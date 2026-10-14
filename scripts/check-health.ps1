<#
.SYNOPSIS  Checks /health (liveness) and /ready (database, PostGIS, migrations, storage) of an API.
.EXAMPLE   .\scripts\check-health.ps1 -ApiUrl https://pramaan-api.onrender.com
#>
param([string]$ApiUrl = 'http://localhost:4000')
$ApiUrl = $ApiUrl.TrimEnd('/')
$ok = $true
foreach ($p in '/health', '/ready') {
  try {
    $r = Invoke-WebRequest -Uri "$ApiUrl$p" -UseBasicParsing -TimeoutSec 20
    Write-Host ("{0,-8} HTTP {1}  {2}" -f $p, $r.StatusCode, $r.Content) -ForegroundColor Green
  } catch {
    $ok = $false
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host ("{0,-8} FAILED (HTTP {1}) {2}" -f $p, $code, $_.Exception.Message) -ForegroundColor Red
  }
}
if (-not $ok) { exit 1 }
