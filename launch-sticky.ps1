[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$Dev,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot

Push-Location $appDir
try {
  if ($Dev) {
    npm run dev
    exit $LASTEXITCODE
  }

  $electronExe = Join-Path $appDir 'node_modules\electron\dist\electron.exe'
  if (-not (Test-Path $electronExe)) {
    Write-Host 'Dependencies not found. Installing npm packages...'
    npm install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed with exit code $LASTEXITCODE"
    }
  }

  $distHtml = Join-Path $appDir 'dist\index.html'
  $mainJs = Join-Path $appDir 'dist-electron\main\main.js'
  if ($Rebuild -or -not (Test-Path $distHtml) -or -not (Test-Path $mainJs)) {
    Write-Host 'Building Antigravity Monitor...'
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed with exit code $LASTEXITCODE"
    }
  }

  if ($Foreground) {
    $fgProc = Start-Process -FilePath $electronExe -ArgumentList '.' -WorkingDirectory $appDir -Wait -PassThru
    exit $fgProc.ExitCode
  }

  $proc = Start-Process -FilePath $electronExe -ArgumentList '.' -WorkingDirectory $appDir -PassThru
  Write-Host "Antigravity Monitor launched (PID $($proc.Id))."
}
finally {
  Pop-Location
}
