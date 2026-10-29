<#
.SYNOPSIS
  MAJIN V6 - Arena bridge control (Windows).

.DESCRIPTION
  Starts and inspects the local Arena bridge and the signed task poller.
  It never installs software, never edits OpenCode settings, never writes the
  V5 data directory and never opens a port beyond 127.0.0.1.

  The scheduled task is OPT-IN: -Action InstallTask prints the exact command
  unless -Apply is also given. -DryRun prints the resolved node command for any
  action without executing it.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Init

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Serve

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Poll

.NOTES
  Read docs/v6/ARENA_BRIDGE.md before enabling job.submit.
#>
[CmdletBinding()]
param(
  [ValidateSet('Init', 'Status', 'Serve', 'Poll', 'Task', 'InstallTask', 'UninstallTask')]
  [string]$Action = 'Status',

  [string]$V6Home = (Join-Path $env:LOCALAPPDATA 'MAJIN\v6'),
  [string]$V5DataDir = (Join-Path $env:LOCALAPPDATA 'MAJIN\v5'),
  [string]$Workspace = (Get-Location).Path,

  [string]$RelayRepo = 'rssen-debug/majin2026',
  [ValidateSet('github', 'http')]
  [string]$Relay = 'github',
  [string]$RelayUrl = 'http://127.0.0.1:8788',

  [ValidateRange(1, 65535)]
  [int]$Port = 8787,

  [ValidateRange(1, 500)]
  [int]$MaxTasks = 5,

  [string]$Kind = 'health.delay',
  [string]$Payload = '{"ms":5}',

  [ValidateRange(1, 1440)]
  [int]$EveryMinutes = 5,

  [string]$TaskName = 'MAJIN-Arena-Poller',

  [switch]$Apply,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The working V5 installation must never be touched by this script.
$protectedInstall = 'C:\MAJINCLI'

function Resolve-FullPath([string]$PathValue) {
  # GetFullPath keeps relative inputs relative to the process CWD and normalises separators.
  return [System.IO.Path]::GetFullPath($PathValue)
}

function Test-PathInside([string]$Child, [string]$Parent) {
  $childFull = (Resolve-FullPath $Child).TrimEnd('\')
  $parentFull = (Resolve-FullPath $Parent).TrimEnd('\')
  return $childFull.Equals($parentFull, [System.StringComparison]::OrdinalIgnoreCase) -or
         $childFull.StartsWith($parentFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Format-Argument([string]$Value) {
  # Scheduled task arguments are a single command line: anything with a space must be quoted.
  if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
  return $Value
}

function Format-CommandLine([string[]]$Items) {
  return (($Items | ForEach-Object { Format-Argument $_ }) -join ' ')
}

$repoRoot = Resolve-FullPath (Join-Path $PSScriptRoot '..\..')
$cliScript = Join-Path $repoRoot 'bin\majin-v6.mjs'
$v6Path = Resolve-FullPath $V6Home
$v5Path = Resolve-FullPath $V5DataDir
$workspacePath = Resolve-FullPath $Workspace

if (-not (Test-Path -LiteralPath $cliScript -PathType Leaf)) {
  throw "majin-v6.mjs not found at $cliScript. Run this script from a complete MAJINCLI checkout."
}
if (Test-PathInside $v6Path $v5Path) {
  throw 'Refusing to run: the V6 home must not be the V5 data directory or inside it.'
}
if (Test-PathInside $v5Path $v6Path) {
  throw 'Refusing to run: the V5 data directory must not be inside the V6 home.'
}
if (Test-PathInside $v6Path $protectedInstall) {
  throw "Refusing to run: the V6 home must not be inside the protected V5 installation ($protectedInstall)."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22+ is required and was not found in PATH. This script does not install it.' }
$nodeExe = $node.Source

$common = @('--v6-home', $v6Path)
$pollArgs = @($cliScript, 'arena', 'poll', '--once') + $common +
            @('--max-tasks', "$MaxTasks", '--workspace', $workspacePath, '--data-dir', $v5Path)

function Invoke-Majin([string[]]$CliArguments) {
  $rendered = Format-CommandLine (@($nodeExe) + $CliArguments)
  Write-Host $rendered -ForegroundColor DarkGray
  if ($DryRun) {
    Write-Host '[DryRun] not executed' -ForegroundColor Yellow
    return 0
  }
  # Send child output straight to the console so it cannot leak into this function's return value.
  & $nodeExe @CliArguments | Out-Host
  return $LASTEXITCODE
}

switch ($Action) {
  'Init' {
    $cliArgs = @($cliScript, 'arena', 'init') + $common + @('--repo', $RelayRepo, '--relay', $Relay, '--port', "$Port")
    if ($Relay -eq 'http') { $cliArgs += @('--relay-url', $RelayUrl) }
    $code = Invoke-Majin $cliArgs
    if ($code -ne 0) { exit $code }
    Write-Host ''
    Write-Host 'Review the policy at ' -NoNewline
    Write-Host (Join-Path $v6Path 'arena\policy.json')
    Write-Host 'Irreversible work (job.submit) stays disabled until you enable it deliberately.'
    exit 0
  }

  'Status' {
    exit (Invoke-Majin (@($cliScript, 'arena', 'status') + $common + @('--json')))
  }

  'Serve' {
    Write-Host 'Local bridge binds 127.0.0.1 only. Ctrl+C stops it.' -ForegroundColor Cyan
    exit (Invoke-Majin (@($cliScript, 'arena', 'serve') + $common + @('--port', "$Port")))
  }

  'Poll' {
    exit (Invoke-Majin $pollArgs)
  }

  'Task' {
    exit (Invoke-Majin (@($cliScript, 'arena', 'task', '--kind', $Kind, '--payload', $Payload) + $common))
  }

  'InstallTask' {
    $action = New-ScheduledTaskAction -Execute $nodeExe -Argument (Format-CommandLine $pollArgs) -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
      -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) `
      -RepetitionDuration ([TimeSpan]::MaxValue)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -MultipleInstances IgnoreNew
    Write-Host "Would register scheduled task '$TaskName' every $EveryMinutes minute(s):" -ForegroundColor Cyan
    Write-Host ('  ' + (Format-CommandLine (@($nodeExe) + $pollArgs)))
    if (-not $Apply) {
      Write-Host ''
      Write-Host 'DRY RUN. Nothing registered. Re-run with -Apply to create the task.' -ForegroundColor Yellow
      Write-Host 'The task runs as your user at limited privilege; it does not require or request elevation.'
      exit 0
    }
    if ($DryRun) { Write-Host '[DryRun] task not registered'; exit 0 }
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
      -RunLevel Limited -Description 'MAJIN V6 Arena poller (signed work only)' | Out-Null
    Write-Host "Registered '$TaskName'." -ForegroundColor Green
    Write-Host "Verify with: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
    exit 0
  }

  'UninstallTask' {
    Write-Host "Would remove scheduled task '$TaskName'."
    if (-not $Apply) { Write-Host 'DRY RUN. Nothing removed. Re-run with -Apply.' -ForegroundColor Yellow; exit 0 }
    if ($DryRun) { Write-Host '[DryRun] task not removed'; exit 0 }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed '$TaskName'." -ForegroundColor Green
    exit 0
  }

  default { throw "Unhandled action '$Action'. This is a bug in the script, not a supported mode." }
}
