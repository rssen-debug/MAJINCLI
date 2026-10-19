<#
.SYNOPSIS
  MAJIN Windows-control PoC probe (handover #4 — PoC-before-bind).
  Runs RAW UI Automation (System.Windows.Automation) with ZERO installed
  dependencies, then emits one structured JSON verdict. The point is evidence,
  not optimism: every capability is a measured bool, and a deliberate negative
  control proves we are not fabricating matches.

  Probes:
    P1  UIA assemblies load; root element enumerates top-level windows.
    P2  Negative control: a window that cannot exist returns null.
    P3  Notepad: launch -> locate window -> locate edit/document control ->
        ValuePattern.SetValue(marker) -> read back -> MUST round-trip -> clear.
    P4  Environment facts (OS, PS, .NET) reported, no installs performed.

  Exit codes: 0 probe completed (gaps allowed, they are data) — 3 UIA unavailable.
#>
param(
  [string]$OutFile = 'probe-result.json'
)

$result = [ordered]@{
  schema    = 'majin.win-uia-probe.v1'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  env = [ordered]@{
    osVersion    = [System.Environment]::OSVersion.VersionString
    psVersion    = $PSVersionTable.PSVersion.ToString()
    clrVersion   = [System.Environment]::Version.ToString()
    machineName  = $env:COMPUTERNAME
    is64Bit      = [System.Environment]::Is64BitOperatingSystem
  }
  p1_assemblyAndRoot = [ordered]@{ loaded = $false; topWindowCount = 0; topWindows = @() }
  p2_negativeControl = [ordered]@{ windowName = 'MAJIN-Nonexistent-Window-7f3b9d2e'; found = $null; nullAsExpected = $false }
  p3_notepad = [ordered]@{
    launched = $false; windowFound = $false; windowName = $null; className = $null
    controlType = $null; valuePatternOk = $false; textPatternOk = $false
    setValueOk = $false; readBackOk = $false; readBackMatches = $false; clearedOk = $false
    closedOk = $false; gapReason = $null
  }
  capabilities = [ordered]@{ identifyWindows = $false; locateControls = $false; textInput = $false; readBack = $false }
  notes = @()
}

function Add-Note([string]$n) { $script:result.notes += $n }

# ---------- P1: assemblies + root enumeration ----------
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
  $script:result.p1_assemblyAndRoot.loaded = $true
} catch {
  $script:result.notes += "UIA assemblies failed to load: $($_.Exception.Message)"
  $result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutFile -Encoding utf8
  Write-Output ($result | ConvertTo-Json -Depth 8 -Compress)
  exit 3
}

$uia      = 'System.Windows.Automation'
$root     = [System.Windows.Automation.AutomationElement]::RootElement
$children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$script:result.p1_assemblyAndRoot.topWindowCount = $children.Count
$top = @()
for ($i = 0; $i -lt [Math]::Min($children.Count, 12); $i++) {
  $w = $children.Item($i)
  $top += [ordered]@{
    name        = $w.Current.Name
    className   = $w.Current.ClassName
    controlType = $w.Current.ControlType.ProgrammaticName
    bounds      = "$([int]$w.Current.BoundingRectangle.X),$([int]$w.Current.BoundingRectangle.Y),$([int]$w.Current.BoundingRectangle.Width),$([int]$w.Current.BoundingRectangle.Height)"
  }
}
$script:result.p1_assemblyAndRoot.topWindows = $top
$script:result.capabilities.identifyWindows = ($children.Count -gt 0)

# ---------- P2: negative control ----------
$ghostCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $result.p2_negativeControl.windowName)
$ghost = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $ghostCond)
$script:result.p2_negativeControl.found = ($null -ne $ghost)
$script:result.p2_negativeControl.nullAsExpected = ($null -eq $ghost)

# ---------- P3: Notepad end-to-end (locate -> input -> readback) ----------
$marker = "MAJIN-POC-" + (Get-Date).ToUniversalTime().ToString('HHmmss')
$proc = $null
try {
  $proc = Start-Process -FilePath 'notepad.exe' -PassThru -ErrorAction Stop
  $script:result.p3_notepad.launched = $true
  Start-Sleep -Milliseconds 2500

  # locate the Notepad window — legacy (className=Notepad) or modern (name contains Notepad)
  $np = $null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 12 -and -not $np) {
    $legacyCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Notepad')
    $np = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $legacyCond)
    if (-not $np) {
      foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($w.Current.Name -match 'notepad') { $np = $w; break }
      }
    }
    if (-not $np) { Start-Sleep -Milliseconds 500 }
  }

  if (-not $np) {
    $script:result.p3_notepad.gapReason = 'notepad window not found within 12s'
  } else {
    $script:result.p3_notepad.windowFound = $true
    $script:result.p3_notepad.windowName  = $np.Current.Name
    $script:result.p3_notepad.className   = $np.Current.ClassName

    # locate the text control: legacy Edit first, then Document (modern)
    $edit = $null
    $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edit = $np.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
    if (-not $edit) {
      $docCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
      $edit = $np.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
    }
    if (-not $edit) {
      $script:result.p3_notepad.gapReason = 'no Edit/Document control under the Notepad window'
    } else {
      $script:result.capabilities.locateControls = $true
      $script:result.p3_notepad.controlType = $edit.Current.ControlType.ProgrammaticName

      $vp = $null; $tp = $null
      try { $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
      try { $tp = $edit.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)  } catch {}
      $script:result.p3_notepad.valuePatternOk = ($null -ne $vp)
      $script:result.p3_notepad.textPatternOk  = ($null -ne $tp)

      if ($vp) {
        try {
          $vp.SetValue($marker)
          $script:result.p3_notepad.setValueOk = $true
          $back = $vp.Current.Value
          $script:result.p3_notepad.readBackOk = ($back -eq $marker)
          $script:result.p3_notepad.readBackMatches = ($back -eq $marker)
          $vp.SetValue('')
          $script:result.p3_notepad.clearedOk = ($vp.Current.Value -eq '')
        } catch {
          $script:result.p3_notepad.gapReason = "ValuePattern write failed: $($_.Exception.Message)"
        }
      } elseif ($tp) {
        # TextPattern has no writer on stock UIA — record the capability boundary honestly
        $script:result.p3_notepad.gapReason = 'only TextPattern available (read-capable, no ValuePattern writer)'
        try {
          $range = $tp.DocumentRange
          $script:result.p3_notepad.readBackOk = $true
        } catch {}
      } else {
        $script:result.p3_notepad.gapReason = 'neither ValuePattern nor TextPattern on the control'
      }
    }
  }
} catch {
  $script:result.p3_notepad.gapReason = "notepad phase failed: $($_.Exception.Message)"
} finally {
  if ($proc -and -not $proc.HasExited) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop; $script:result.p3_notepad.closedOk = $true } catch { $script:result.p3_notepad.closedOk = $false }
  } elseif ($proc) { $script:result.p3_notepad.closedOk = $true }
}

$script:result.capabilities.textInput = $script:result.p3_notepad.setValueOk
$script:result.capabilities.readBack  = $script:result.p3_notepad.readBackMatches

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutFile -Encoding utf8
Write-Output ($result | ConvertTo-Json -Depth 8)
exit 0
