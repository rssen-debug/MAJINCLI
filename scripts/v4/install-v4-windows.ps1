# MAJIN V4 — Windows host installer.
#
# What this does:
#   1. verifies Node >= 22
#   2. installs the repo's npm dependencies if they are missing
#   3. writes a launcher (start-majin-v4.cmd) that runs the V4 host in this repo
#   4. optionally registers a per-user Scheduled Task at logon
#
# What this does NOT do:
#   - no machine-wide changes, no service account, no firewall rule
#   - no silent configuration of providers or keys
#   - no tunnel, no port forwarding, no RDP
#
# Usage (PowerShell, normal user):
#   powershell -ExecutionPolicy Bypass -File .\scripts\v4\install-v4-windows.ps1
#   ... -AutoStart        register the logon task
#   ... -Uninstall        remove the logon task and launcher
param(
  [switch]$AutoStart,
  [switch]$Uninstall,
  [int]$Port = 7373
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TaskName = 'MAJIN V4 Host'
$Launcher = Join-Path $RepoRoot 'start-majin-v4.cmd'

function Write-Step($text) { Write-Host "  $text" }
function Fail($text) { Write-Host "  FEL: $text" -ForegroundColor Red; exit 1 }

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Step "Tog bort den schemalagda uppgiften '$TaskName'."
  }
  if (Test-Path $Launcher) { Remove-Item $Launcher -Force; Write-Step "Tog bort $Launcher." }
  Write-Step 'Avinstallerat. Data i %LOCALAPPDATA%\MAJIN\v4 ligger kvar.'
  exit 0
}

Write-Host "`nMAJIN V4 — Windows host`n" -ForegroundColor Magenta

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js saknas. Installera Node 22 LTS från https://nodejs.org och kör igen.' }
$nodeVersion = (& node -p "process.versions.node").Trim()
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) { Fail "Node $nodeVersion är för gammalt. MAJIN V4 kräver >= 22." }
Write-Step "Node $nodeVersion"

if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
  Write-Step 'Installerar npm-beroenden (npm ci, inga skript)...'
  Push-Location $RepoRoot
  try { & npm ci --ignore-scripts --no-audit --no-fund | Out-Null } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci misslyckades. Kör npm ci manuellt för att se felet.' }
}
Write-Step 'Beroenden finns.'

$nodePath = $node.Source
@"
@echo off
rem MAJIN V4 host — startad av användaren, inte av systemet.
set MAJIN_V4_PORT=$Port
cd /d "$RepoRoot"
"$nodePath" src\v4\main.js %*
"@ | Set-Content -Path $Launcher -Encoding ASCII
Write-Step "Launcher: $Launcher"

Write-Step 'Kör host-doctor...'
Push-Location $RepoRoot
try { & node scripts/v4/host-doctor.mjs } finally { Pop-Location }

if ($AutoStart) {
  $action = New-ScheduledTaskAction -Execute $Launcher -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Startar MAJIN V4 när användaren loggar in.' -Force | Out-Null
  Write-Step "Schemalagd uppgift '$TaskName' registrerad för $env:USERNAME (endast inloggning, ingen maskinbred ändring)."
} else {
  Write-Step 'Ingen automatisk start vald. Kör med -AutoStart för en inloggningstask.'
}

Write-Host "`nKlart. Starta med: $Launcher" -ForegroundColor Green
Write-Host 'Parkoden skrivs ut i konsolen första gången. Dela den aldrig i chat eller e-post.'
Write-Host 'Publikt HTTPS: se docs/v4/DEPLOYMENT.md (Cloudflare Tunnel + Access).'
