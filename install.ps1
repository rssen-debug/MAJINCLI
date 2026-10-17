<#
  MAJIN — installation på Windows.
  Kräver inga admin-rättigheter, ingen byggradie, ingen npm-rotation för kärnan.

    powershell -ExecutionPolicy Bypass -File .\install.ps1              # installera (PATH + genväg + start-menyn)
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -WhatsApp   # + Baileys för personligt WhatsApp-nummer
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -NoPath     # rör inte PATH
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall  # pilla bort det igen
#>
[CmdletBinding()]
param(
  [switch]$WhatsApp,
  [switch]$NoPath,
  [switch]$NoTask,
  [switch]$Uninstall,
  [string]$Home = "$env:LOCALAPPDATA\MAJIN"
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bin = Join-Path $Home 'bin'

function Write-Step([string]$m) { Write-Host "  · $m" -ForegroundColor DarkGray }
function Write-Ok([string]$m) { Write-Host "✔ $m" -ForegroundColor Green }
function Write-Bad([string]$m) { Write-Host "✖ $m" -ForegroundColor Red }

if ($Uninstall) {
  Write-Host "avlägsnar MAJIN (data i $Home lämnas orörda)" -ForegroundColor Cyan
  Get-ScheduledTask -TaskName 'MAJIN' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
  Write-Step 'schematisk start uppgift borta'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -and $userPath -like "*$Bin*") {
    $new = ($userPath -split ';' | Where-Object { $_ -ne $Bin }) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $new, 'User')
    Write-Step "PATH: $Bin borttagen"
  }
  foreach ($s in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\MAJIN", "$env:USERPROFILE\Desktop\MAJIN.lnk")) {
    if (Test-Path $s) { Remove-Item $s -Recurse -Force; Write-Step "tog bort $s" }
  }
  Write-Ok 'MAJIN avinstallerat. Config/nycklar ligger kvar i' $Home
  exit 0
}

Write-Host "MAJIN installeras från $Repo" -ForegroundColor Cyan
Write-Host "data + config: $Home`n" -ForegroundColor DarkCyan

# --- 1. Node ---------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Bad 'Node hittades inte i PATH.'
  Write-Host '  Installera LTS (>= 20.11): winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
  Write-Host '  Starta om PowerShell och kör install.ps1 igen.' -ForegroundColor Yellow
  exit 1
}
$ver = (& node -v) -replace '^v', ''
$parts = $ver.Split('.')
$okNode = ([int]$parts[0] -gt 20) -or ([int]$parts[0] -eq 20 -and ([int]$parts[1] -gt 11 -or ([int]$parts[1] -eq 11 -and [int]$parts[2] -ge 0)))
if (-not $okNode) {
  Write-Bad "Node $ver är för gammal — MAJIN behöver 20.11 eller senare (fetch, structuredClone, --test)."
  exit 1
}
Write-Ok "Node $ver ($($node.Source))"

# --- 2. Datakataloger ------------------------------------------------------
foreach ($d in @('', 'workspace', 'memory', 'sessions', 'skills', 'rules', 'logs', 'out', 'uploads', 'cache', 'creds', 'bin')) {
  $p = Join-Path $Home $d
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
Write-Step "datakataloger redo i $Home"

# --- 3. start-skript + PATH -------------------------------------------------
if (-not $NoPath) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$Bin*") {
    [Environment]::SetEnvironmentVariable('Path', "$Bin;$userPath", 'User')
    Write-Step "PATH (användare): $Bin lagts först"
  } else { Write-Step 'PATH: redan installerad' }
}
$cmd = @"
@echo off
rem MAJIN — starta agenten (server + fönster)
setlocal
if "%MAJIN_HOME%"=="" set "MAJIN_HOME=$Home"
where node >nul 2>nul || (echo Node saknas - installera Node LTS 20.11+ & exit /b 1)
pushd "$Repo"
node "src\cli\majin.js" start %*
popd
"@
Set-Content -Path (Join-Path $Bin 'majin-start.cmd') -Value $cmd -Encoding ASCII
$shellRc = @"
@echo off
setlocal
if "%MAJIN_HOME%"=="" set "MAJIN_HOME=$Home"
pushd "$Repo"
node "src\cli\majin.js" start --no-window %*
popd
"@
Set-Content -Path (Join-Path $Bin 'majin-serve.cmd') -Value $shellRc -Encoding ASCII
$wrapper = @"
@echo off
setlocal
if "%MAJIN_HOME%"=="" set "MAJIN_HOME=$Home"
pushd "$Repo"
node "src\cli\majin.js" %*
popd
"@
Set-Content -Path (Join-Path $Bin 'majin.cmd') -Value $wrapper -Encoding ASCII
Write-Ok 'majin.cmd / majin-start.cmd / majin-serve.cmd i' $Bin

# --- 4. Genvägar ------------------------------------------------------------
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\MAJIN"
if (-not (Test-Path $startMenu)) { New-Item -ItemType Directory -Path $startMenu -Force | Out-Null }
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startMenu 'MAJIN.lnk'))
$lnk.TargetPath = Join-Path $Bin 'majin-start.cmd'
$lnk.WorkingDirectory = $Repo
$lnk.Description = 'Startar MAJIN-agenten och öppnar fönstret'
$lnk.Save()
$desk = $ws.CreateShortcut("$env:USERPROFILE\Desktop\MAJIN.lnk")
$desk.TargetPath = Join-Path $Bin 'majin-start.cmd'
$desk.WorkingDirectory = $Repo
$desk.Description = 'MAJIN — agenten på din egen maskin'
$desk.Save()
Write-Ok 'genväg på skrivbordet + startmenyn'

# --- 5. Autostart (valfritt) -----------------------------------------------
if (-not $NoTask) {
  try {
    $action = New-ScheduledTaskAction -Execute (Join-Path $Bin 'majin-serve.cmd')
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName 'MAJIN' -Action $action -Trigger $trigger -Settings $settings -Description 'Startar MAJIN-agenten i bakgrunden' -Force | Out-Null
    Write-Ok 'MAJIN startar vid inloggning (Task Scheduler)'
  } catch {
    Write-Step "hoppar över autostart: $($_.Exception.Message)"
  }
} else { Write-Step 'autostart utelämnat (-NoTask)' }

# --- 6. Valfria beroenden ---------------------------------------------------
if ($WhatsApp) {
  Write-Host "`ninstallerar WhatsApp-stöd (Baileys) …" -ForegroundColor Cyan
  Push-Location $Repo
  try {
    & npm install --no-audit --no-fund @whiskeysockets/baileys@7.0.0-rc14 qrcode@1.5.4
    if ($LASTEXITCODE -eq 0) { Write-Ok 'Baileys på plats — kör: majin pair whatsapp' }
    else { Write-Bad 'npm install misslyckades — WhatsApp-cloud-transporten fungerar ändå (ingen dep)' }
  } catch {
    Write-Bad "npm felade: $($_.Exception.Message)"
  }
  Pop-Location
}

# --- 7. Verifiera ------------------------------------------------------------
Write-Host "`nkontrollerar …" -ForegroundColor Cyan
Push-Location $Repo
$env:MAJIN_HOME = $Home
& node 'src\cli\majin.js' doctor
$doctorExit = $LASTEXITCODE
Write-Host ''
& node 'src\cli\majin.js' url
Pop-Location
Write-Host ''
if ($doctorExit -ne 0) { Write-Host 'doctor hade anmärkningar — åtgärda punkterna ovan (API-nyckel är det vanliga).' -ForegroundColor Yellow }
Write-Host 'KLART. Öppna ett nytt fönster och kör:  majin' -ForegroundColor Green
Write-Host '   (eller dubbelklicka MAJIN på skrivbordet. Tryck Ctrl+C för att stoppa.)' -ForegroundColor DarkGray
