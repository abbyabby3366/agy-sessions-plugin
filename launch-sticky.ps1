[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$Dev,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot

function Get-MonitorElectronProcesses {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$appDir*" }
}

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

  $existing = @(Get-MonitorElectronProcesses)
  if ($existing.Count -gt 0) {
    Write-Host 'Stopping running Antigravity Sessions instance...'
    foreach ($p in $existing) {
      Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    # Wait for main and child processes (GPU/Network cache) to release lockfile and disk cache handles
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
      $remaining = @(Get-MonitorElectronProcesses)
      if ($remaining.Count -eq 0) { break }
      Start-Sleep -Milliseconds 100
    }
    Start-Sleep -Milliseconds 150
  }

  $distHtml = Join-Path $appDir 'dist\index.html'
  $mainJs = Join-Path $appDir 'dist-electron\main\main.js'
  if ($Rebuild -or -not (Test-Path $distHtml) -or -not (Test-Path $mainJs)) {
    Write-Host 'Building Antigravity Sessions...'
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed with exit code $LASTEXITCODE"
    }
  }

  if ($Foreground) {
    $fgProc = Start-Process -FilePath $electronExe -ArgumentList '.' -WorkingDirectory $appDir -Wait -PassThru
    exit $fgProc.ExitCode
  }

  $logDir = Join-Path $env:LOCALAPPDATA 'agy-sticky-monitor'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stdoutLog = Join-Path $logDir 'stdout.log'
  $stderrLog = Join-Path $logDir 'stderr.log'

  $proc = Start-Process `
    -FilePath $electronExe `
    -ArgumentList '.' `
    -WorkingDirectory $appDir `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  Write-Host "Antigravity Sessions launched (PID $($proc.Id))."
}
finally {
  Pop-Location
}
