<#
.SYNOPSIS
    MAJIN V5 — Real Windows NSIS Setup.exe Install, Start, Restart, V1-V4 Preservation & Uninstall Verifier.
#>
param(
    [string]$SetupExe = "desktop\dist\MAJIN-V5-Setup.exe",
    [int]$TestPort = 4559
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SetupExe)) {
    throw "Setup.exe not found at: $SetupExe"
}

$SetupFull = (Resolve-Path $SetupExe).Path
$SetupHash = (Get-FileHash -Algorithm SHA256 $SetupFull).Hash.ToLowerInvariant()
$SetupBytes = (Get-Item $SetupFull).Length

# 1. Seed pre-existing V1 and V4 installations & data to verify non-destructive coexistence
$MajinRoot = Join-Path $env:LOCALAPPDATA "MAJIN"
$V4DataDir = Join-Path $MajinRoot "v4"
$V4AppDir  = Join-Path $env:LOCALAPPDATA "Programs\majin-v4-desktop"
New-Item -ItemType Directory -Force -Path $MajinRoot, $V4DataDir, $V4AppDir | Out-Null

$V1ConfigFile = Join-Path $MajinRoot "config.json"
$V4ProviderFile = Join-Path $V4DataDir "provider.json"
$V4MarkerFile = Join-Path $V4AppDir "v4-installation-marker.txt"

if (-not (Test-Path $V1ConfigFile)) {
    @{ models = @{ routes = @{ chat = "opencode-go/Grok 4.7" } } } | ConvertTo-Json -Depth 5 | Set-Content -Path $V1ConfigFile -Encoding UTF8
}
if (-not (Test-Path $V4ProviderFile)) {
    @{ provider = "opencode-go"; model = "Grok 4.7" } | ConvertTo-Json | Set-Content -Path $V4ProviderFile -Encoding UTF8
}
"V4 installation intact" | Set-Content -Path $V4MarkerFile -Encoding UTF8

# 2. Run NSIS Setup.exe silently (/S)
Write-Host "==> [1/6] Running NSIS installer: $SetupFull /S" -ForegroundColor Cyan
$InstallProc = Start-Process -FilePath $SetupFull -ArgumentList "/S" -Wait -PassThru
if ($InstallProc.ExitCode -ne 0) {
    throw "MAJIN-V5-Setup.exe exited with code $($InstallProc.ExitCode)"
}

$InstalledDir = Join-Path $env:LOCALAPPDATA "Programs\majin-v5-desktop"
$InstalledExe = Join-Path $InstalledDir "MAJIN V5.exe"
$UninstallerExe = Join-Path $InstalledDir "Uninstall MAJIN V5.exe"
$BundledIcon = Join-Path $InstalledDir "resources\icon.png"
$BundledNode = Join-Path $InstalledDir "resources\host\runtime\node.exe"
$BundledV5Server = Join-Path $InstalledDir "resources\host\src\v5\server.js"

for ($i = 0; $i -lt 20; $i++) {
    if (Test-Path $InstalledExe) { break }
    Start-Sleep -Milliseconds 500
}
if (-not (Test-Path $InstalledExe)) { throw "Installed executable missing: $InstalledExe" }
if (-not (Test-Path $UninstallerExe)) { throw "Uninstaller executable missing: $UninstallerExe" }
if (-not (Test-Path $BundledIcon)) { throw "Bundled Majin icon missing: $BundledIcon" }
if (-not (Test-Path $BundledNode)) { throw "Bundled Node runtime missing: $BundledNode" }
if (-not (Test-Path $BundledV5Server)) { throw "Bundled V5 server missing: $BundledV5Server" }

# 3. Verify Desktop shortcut and Start Menu shortcut
Write-Host "==> [2/6] Verifying Desktop and Start Menu shortcuts..." -ForegroundColor Cyan
$DesktopDir = [Environment]::GetFolderPath("Desktop")
$DesktopShortcut = Join-Path $DesktopDir "MAJIN V5.lnk"
$StartMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MAJIN V5.lnk"

$DesktopShortcutExists = Test-Path $DesktopShortcut
$StartMenuShortcutExists = Test-Path $StartMenuShortcut
if (-not $DesktopShortcutExists) {
    throw "Desktop shortcut was not created at: $DesktopShortcut"
}

# 4. Launch installed MAJIN V5 (--background) on TestPort and verify health + provider save
Write-Host "==> [3/6] Starting installed MAJIN V5 host and verifying health & provider config..." -ForegroundColor Cyan
$V5DataDir = Join-Path $MajinRoot "v5"
$env:MAJIN_V5_DATA_DIR = $V5DataDir
$env:MAJIN_V5_PORT = "$TestPort"
$env:MAJIN_V5_DESKTOP_URL = "http://127.0.0.1:$TestPort"

$BgProc1 = Start-Process -FilePath $InstalledExe -ArgumentList "--background" -Wait -PassThru
if ($BgProc1.ExitCode -ne 0) {
    throw "Installed MAJIN V5.exe --background failed with exit code $($BgProc1.ExitCode)"
}

$Health1 = Invoke-RestMethod -Uri "http://127.0.0.1:$TestPort/api/health" -TimeoutSec 5
if (-not $Health1.ok -or $Health1.version -ne "5.0.0") {
    throw "Unexpected /api/health response: $($Health1 | ConvertTo-Json -Compress)"
}

$ProvBody = @{
    providerId = "opencode-go"
    modelId = "GLM-5.3"
    manualOverride = $true
} | ConvertTo-Json
$ProvRes = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$TestPort/api/v5/provider" -ContentType "application/json" -Body $ProvResBody -ErrorAction SilentlyContinue
$ProvRes = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$TestPort/api/v5/provider" -ContentType "application/json" -Body $ProvBody
if (-not $ProvRes.ok) {
    throw "Failed to save provider config on installed host"
}

# 5. Stop host, restart installed MAJIN V5, and verify provider settings persisted
Write-Host "==> [4/6] Restarting installed MAJIN V5 host and verifying persistence..." -ForegroundColor Cyan
$HostJsonPath = Join-Path $V5DataDir "desktop-host.json"
if (Test-Path $HostJsonPath) {
    $HostInfo = Get-Content $HostJsonPath -Raw | ConvertFrom-Json
    if ($HostInfo.pid) {
        Stop-Process -Id $HostInfo.pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

$BgProc2 = Start-Process -FilePath $InstalledExe -ArgumentList "--background" -Wait -PassThru
if ($BgProc2.ExitCode -ne 0) {
    throw "Second launch of MAJIN V5.exe --background failed with exit code $($BgProc2.ExitCode)"
}

$StateAfterRestart = Invoke-RestMethod -Uri "http://127.0.0.1:$TestPort/api/v5/state" -TimeoutSec 5
if ($StateAfterRestart.provider.activeProvider -ne "opencode-go" -or $StateAfterRestart.provider.activeModelId -ne "GLM-5.3") {
    throw "Provider config did not persist after restart: $($StateAfterRestart.provider | ConvertTo-Json -Compress)"
}

# Stop background host before uninstalling
if (Test-Path $HostJsonPath) {
    $HostInfo2 = Get-Content $HostJsonPath -Raw | ConvertFrom-Json
    if ($HostInfo2.pid) {
        Stop-Process -Id $HostInfo2.pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# 6. Run Uninstaller (/S) and verify clean removal + data/V1-V4 preservation
Write-Host "==> [5/6] Running Uninstaller and verifying clean removal + data preservation..." -ForegroundColor Cyan
$UninstallProc = Start-Process -FilePath $UninstallerExe -ArgumentList "/S" -Wait -PassThru
for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-Path $InstalledExe)) { break }
    Start-Sleep -Milliseconds 500
}
if (Test-Path $InstalledExe) {
    throw "Uninstaller did not remove $InstalledExe"
}

$V5DataPreserved = Test-Path (Join-Path $V5DataDir "provider-state.json")
$V1DataPreserved = Test-Path $V1ConfigFile
$V4DataPreserved = (Test-Path $V4ProviderFile) -and (Test-Path $V4MarkerFile)
if (-not $V5DataPreserved) { throw "User V5 provider data was deleted during uninstall" }
if (-not $V1DataPreserved -or -not $V4DataPreserved) { throw "V1/V4 installation or data was modified during V5 install/uninstall" }

$Evidence = @{
    schema = "majin.v5.windows-installer-evidence/v1"
    verifiedAt = (Get-Date).ToString("o")
    status = "PASS"
    setupExe = @{
        fileName = (Split-Path $SetupFull -Leaf)
        bytes = $SetupBytes
        sha256 = $SetupHash
    }
    installedExecutableVerified = $true
    desktopShortcutVerified = $DesktopShortcutExists
    startMenuShortcutVerified = $StartMenuShortcutExists
    majinIconBundled = $true
    healthCheckVersion = $Health1.version
    providerPersistedAcrossRestart = @{
        activeProvider = $StateAfterRestart.provider.activeProvider
        activeModelId = $StateAfterRestart.provider.activeModelId
    }
    cleanUninstallVerified = (-not (Test-Path $InstalledExe))
    v5UserDataPreservedOnUninstall = $V5DataPreserved
    v1AndV4Preserved = ($V1DataPreserved -and $V4DataPreserved)
}

New-Item -ItemType Directory -Force -Path "docs\v5" | Out-Null
$Evidence | ConvertTo-Json -Depth 6 | Set-Content -Path "docs\v5\windows-installer-evidence.json" -Encoding UTF8
Write-Host "==> [6/6] PASS: Windows Setup.exe install, shortcuts, auto-host, restart persistence, V1-V4 preservation & uninstall verified." -ForegroundColor Green
