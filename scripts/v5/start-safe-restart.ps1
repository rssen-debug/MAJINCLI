# Safe MAJIN V5 launcher for Windows PowerShell 5.1+ / PowerShell 7.
# This file does not run git pull, npm ci, grants, model select or automatic resume.
[CmdletBinding()]
param(
    [string]$CliRoot = "",
    [string]$DataDir = "",
    [switch]$InspectOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail-Safely([string]$Message) {
    Write-Host "MAJIN: $Message" -ForegroundColor Yellow
    exit 1
}
try { $node = Get-Command node.exe -ErrorAction Stop }
catch { Fail-Safely "Node.js kunde inte hittas. Ingen andring gjord." }

if (-not $CliRoot -and $env:MAJIN_V5_CLI_ROOT) { $CliRoot = $env:MAJIN_V5_CLI_ROOT }
if (-not $CliRoot) {
    $candidates = @()
    $localInstallDir = Join-Path $env:LOCALAPPDATA "MAJIN"
    if (Test-Path -LiteralPath "C:\MAJINCLI\bin\majin-v5.mjs" -PathType Leaf) { $candidates += "C:\MAJINCLI" }
    if (Test-Path -LiteralPath $localInstallDir -PathType Container) {
        $candidates += @(Get-ChildItem -LiteralPath $localInstallDir -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "cli-*" -and (Test-Path -LiteralPath (Join-Path $_.FullName "bin\majin-v5.mjs") -PathType Leaf) } |
            ForEach-Object { $_.FullName })
    }
    $repoNextToScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
    if (Test-Path -LiteralPath (Join-Path $repoNextToScript "bin\majin-v5.mjs") -PathType Leaf) { $candidates += $repoNextToScript }
    $candidates = @($candidates | Sort-Object -Unique)
    if ($candidates.Count -eq 0) { Fail-Safely "Ingen MAJIN V5 hittades. Ange -CliRoot 'C:\din\MAJINCLI'." }
    if ($candidates.Count -gt 1) {
        Write-Host "Flera installationer hittades. Valj en explicit med -CliRoot:" -ForegroundColor Yellow
        $candidates | ForEach-Object { Write-Host "  $_" }
        exit 2
    }
    $CliRoot = $candidates[0]
}
$CliRoot = [IO.Path]::GetFullPath($CliRoot)
$cli = Join-Path $CliRoot "bin\majin-v5.mjs"
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { Fail-Safely "Hittade inte $cli. Ingen andring gjord." }

if (-not $DataDir -and $env:MAJIN_V5_DATA_DIR) { $DataDir = $env:MAJIN_V5_DATA_DIR }
if (-not $DataDir -and $env:MAJIN_HOME) { $DataDir = Join-Path $env:MAJIN_HOME "v5" }
if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA "MAJIN\v5" }
$DataDir = [IO.Path]::GetFullPath($DataDir)
if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) {
    Fail-Safely "Datamappen finns inte: $DataDir. Stoppar hellre an att skapa en ny profil. Ange ratt -DataDir."
}
try {
    $running = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe' OR Name = 'MAJIN V5.exe'" -ErrorAction Stop |
        Where-Object {
            $_.CommandLine -and (
                $_.CommandLine -match 'majin-v5\.mjs|desktop-host\.mjs' -or
                ($_.Name -eq 'MAJIN V5.exe')
            ) -and $_.ProcessId -ne $PID
        })
} catch { Fail-Safely "Kan inte kontrollera befintliga MAJIN-processer. Avbryter for att undvika dubbel korning." }

Write-Host ""
Write-Host "MAJIN V5 - saker start" -ForegroundColor Cyan
Write-Host "Kod:  $CliRoot"
Write-Host "Data: $DataDir"
Write-Host "Befintlig checkpoint: $(Test-Path -LiteralPath (Join-Path $DataDir 'provider-agent\current.json') -PathType Leaf)"
Write-Host "Ingen git pull, npm ci, modellandring, grant eller radering."
if ($running.Count -gt 0) {
    Write-Host "En MAJIN-process kor redan. Ingen ny start gjord:" -ForegroundColor Yellow
    $running | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize
    exit 2
}
if ($InspectOnly) {
    Write-Host "Inspektion klar. Ingenting startades eller andrades." -ForegroundColor Green
    exit 0
}
Write-Host "Startar befintlig V5 chat med synlig webblasare..." -ForegroundColor Green
Write-Host "Kommandon: /status, /checkpoint, /resume, /pause och /exit."
Write-Host "En osaker checkpoint aterupptas INTE automatiskt."
Push-Location -LiteralPath $CliRoot
try {
    & $node.Source $cli chat --data-dir $DataDir --browser-visible
    $code = $LASTEXITCODE
} finally { Pop-Location }
if ($code -ne 0) { Write-Host "MAJIN avslutades med felkod $code. Startfilen har inte andrat data." -ForegroundColor Yellow }
exit $code
