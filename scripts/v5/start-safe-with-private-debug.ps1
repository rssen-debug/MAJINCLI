# Launch the existing MAJIN V5, with a separate observer that may upload
# allowlisted operational metadata ONLY to a GitHub repository proven private.
# No git pull, npm ci, access-grant modification, model selection or auto resume.
[CmdletBinding()]
param(
  [string]$CliRoot = "",
  [string]$DataDir = "",
  [string]$PrivateDebugRepo = "rssen-debug/majin2026",
  [switch]$NoPrivateDebug,
  [switch]$InspectOnly
)
$ErrorActionPreference = "Stop"
if (-not $DataDir) {
  if ($env:MAJIN_V5_DATA_DIR) { $DataDir = $env:MAJIN_V5_DATA_DIR }
  elseif ($env:MAJIN_HOME) { $DataDir = Join-Path $env:MAJIN_HOME "v5" }
  else { $DataDir = Join-Path $env:LOCALAPPDATA "MAJIN\v5" }
}
$DataDir = [IO.Path]::GetFullPath($DataDir)
$launcher = Join-Path $PSScriptRoot "start-safe-restart.ps1"
$observer = Join-Path $PSScriptRoot "private-debug-overview.mjs"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Safe launcher not found: $launcher" }
if (-not (Test-Path -LiteralPath $observer -PathType Leaf)) { throw "Private observer not found: $observer" }
if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) {
  throw "V5 data directory not found: $DataDir. Refusing to create a new profile."
}
$launchArgs = @{ DataDir = $DataDir }
if ($CliRoot) { $launchArgs.CliRoot = $CliRoot }
if ($InspectOnly) {
  $launchArgs.InspectOnly = $true
  & $launcher @launchArgs
  exit $LASTEXITCODE
}
$job = $null
try {
  if (-not $NoPrivateDebug) {
    # A child PowerShell job keeps this monitor independent from the agent.
    # The observer itself verifies github.repo.private===true before upload.
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $job = Start-Job -Name "MAJIN-private-debug" -ScriptBlock {
      param($nodePath, $observerPath, $dataPath, $privateRepo)
      & $nodePath $observerPath --watch --data-dir $dataPath --private-repo $privateRepo
    } -ArgumentList $node, $observer, $DataDir, $PrivateDebugRepo
    Start-Sleep -Seconds 2
    if ($job.State -ne "Running") {
      Write-Warning "Private debug observer could not start. MAJIN itself remains unchanged."
      Receive-Job -Job $job -Keep | Out-Host
    } else {
      Write-Host "Private debug observer enabled for $PrivateDebugRepo" -ForegroundColor Cyan
      Write-Host "Only sanitized execution metadata is uploaded. Local trace stays on your PC."
    }
  }
  & $launcher @launchArgs
} finally {
  if ($job) {
    if ($job.State -eq "Running") { Stop-Job -Job $job -ErrorAction SilentlyContinue }
    Receive-Job -Job $job -ErrorAction SilentlyContinue | Out-Host
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
}
