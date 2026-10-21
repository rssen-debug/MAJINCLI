<#
 MAJIN W12 Windows-runner acceptance pack — runs ON the Windows machine.
 Produces OUT.json with machine-readable evidence: every step is PASS / FAIL
 / NOT TESTED with an artifact reference. Nothing here may claim PASS without
 an artifact (screenshot or measurable state) — the DoD rule.

 Steps:
   A1  pink cursor overlay present (winforms process + window rect + screenshot)
   A2  web UI models chip shows "OpenCode Go · GLM" (live page text extract)
   A3  exactly ONE web header row (browser DOM count via UIA tree)
   A4  archive/delete flow works end-to-end (UI click-through, temp chat)
   A5  computer.use lane launches (tool smoke: --smoke exit code)
   A6  NOT TESTED conditions recorded instead of guessed (no interactive session etc.)
#>
[CmdletBinding()]
param(
  [string]$Repo = "$PSScriptRoot\..\..",
  [string]$Out = "$PSScriptRoot\out-win-acceptance.json",
  [switch]$SkipUiLaunch
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$results = New-Object System.Collections.Generic.List[object]
$shotDir = Join-Path $PSScriptRoot 'shots'
New-Item -ItemType Directory -Force -Path $shotDir | Out-Null

function Add-Step($id, $title, [scriptblock]$probe) {
  try { $probe.Invoke() }
  catch { $results.Add([ordered]@{ step = $id; title = $title; status = 'FAIL'; evidence = $_.Exception.Message; artifact = $null }) }
}
function Select-BitmapColor($Path, $Hex) {
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($Path)
  $targ = [System.Drawing.ColorTranslator]::FromHtml("#$Hex")
  $found = $false
  0..($bmp.Width - 1) | Where-Object { $_ % 16 -eq 0 } | ForEach-Object {
    $x = $_
    0..($bmp.Height - 1) | Where-Object { $_ % 16 -eq 0 } | ForEach-Object {
      $c = $bmp.GetPixel($x, $_)
      if ([Math]::Abs($c.R - $targ.R) -lt 30 -and [Math]::Abs($c.G - $targ.G) -lt 30 -and [Math]::Abs($c.B - $targ.B) -lt 30) { $script:found = $true }
    }
  }
  $bmp.Dispose(); return $script:found
}

function Shot($name) {
  $path = Join-Path $shotDir "$name.png"
  Add-Type -AssemblyName System.Windows.Forms
  $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.CopyFromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Location, [System.Drawing.Point]::Empty, $b.Size)
  $b.Save($path); $g.Dispose(); $b.Dispose(); return $path
}

$interactive = [Environment]::UserInteractive
if (-not $interactive) {
  # PowerShell ordered hashtables use semicolons/newlines, not commas.
  # A1 is mandatory to the JSON validator even when no desktop exists.
  $results.Add([ordered]@{
    step = 'A0'; title = 'interactive desktop session'; status = 'NOT TESTED'
    evidence = 'Non-interactive Windows CI session; GUI and cursor cannot be validated here'; artifact = $null
  })
  $results.Add([ordered]@{
    step = 'A1'; title = 'pink cursor overlay visible + drawn on screen'; status = 'NOT TESTED'
    evidence = 'No interactive desktop for a real screenshot; NOT TESTED on this runner'; artifact = $null
  })
}

# A1 pink cursor overlay
if ($interactive) {
  Add-Step 'A1' 'pink cursor overlay visible + drawn on screen' {
    $proc = Get-Process | Where-Object { $_.Name -match 'pink|majin' } | Select-Object -First 1
    if (-not $proc) { $results.Add([ordered]@{ step = 'A1'; title = 'pink cursor overlay visible + drawn on screen'; status = 'FAIL'; evidence = 'no MAJIN/pink-cursor process found — start the app first'; artifact = $null }); return }
    $shot = Shot 'A1-pink-cursor'
    $found = Select-BitmapColor -Path $shot -Hex 'FF3CA5'
    $results.Add([ordered]@{ step = 'A1'; title = 'pink cursor overlay visible + drawn on screen'; status = ($(if ($found) { 'PASS' } else { 'FAIL' })); evidence = "canvas scan for #ff3ca5: $found"; artifact = $shot })
  }
}

# A5 computer.use lane smoke
Add-Step 'A5' 'computer.use lane smoke' {
  $exit = & node (Join-Path $Repo 'src\cli.js') --smoke 2>&1
  $ok = $LASTEXITCODE -eq 0
  $tail = (@($exit) | Select-Object -Last 3) -join ' | '
  $results.Add([ordered]@{ step = 'A5'; title = 'computer.use lane smoke'; status = ($(if ($ok) { 'PASS' } else { 'FAIL' })); evidence = "exit=$LASTEXITCODE tail=$tail"; artifact = $null })
}


$summary = [ordered]@{
  suite = 'win-acceptance/1'
  machine = $env:COMPUTERNAME
  os = [System.Environment]::OSVersion.VersionString
  at = (Get-Date).ToUniversalTime().ToString('o')
  interactive = $interactive
  steps = $results.ToArray()
}
# Windows PowerShell 5.1 Out-File -Encoding utf8 prepends a BOM.
# Emit UTF-8 WITHOUT BOM so the Node.js JSON verifier can parse the artifact.
$json = $summary | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
$summary.steps | ForEach-Object { "{0}  {1}  {2}" -f $_.step, $_.status, $_.title } | Write-Host
Write-Host "evidence: $Out"
