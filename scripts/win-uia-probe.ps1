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
    P5  (v2) If P3 cannot find a text control: dump the Notepad subtree
        (name/class/controlType/supported patterns per node, capped), then
        retry text input through (a) ANY descendant exposing ValuePattern and
        (b) a zero-dependency SendKeys focus fallback. This is the evidence
        needed to decide raw-UIA vs external binding (FlaUI/UFO).

  Exit codes: 0 probe completed (gaps allowed, they are data) — 3 UIA unavailable.
#>
param(
  [string]$OutFile = 'probe-result.json'
)

$result = [ordered]@{
  schema    = 'majin.win-uia-probe.v2.2'
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
  env = [ordered]@{
    osVersion    = [System.Environment]::OSVersion.VersionString
    psVersion    = $PSVersionTable.PSVersion.ToString()
    clrVersion   = [System.Environment]::Version.ToString()
    machineName  = $env:COMPUTERNAME
    is64Bit      = [System.Environment]::Is64BitOperatingSystem
    # v2.1: session identity — proves/disproves the Session-0 (non-interactive
    # service desktop) hypothesis behind zero-pattern controls + dead SendKeys.
    userName        = [System.Environment]::UserName
    userDomain      = [System.Environment]::UserDomainName
    userInteractive = [System.Environment]::UserInteractive
    sessionId       = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  }
  p1_assemblyAndRoot = [ordered]@{ loaded = $false; topWindowCount = 0; topWindows = @() }
  p2_negativeControl = [ordered]@{ windowName = 'MAJIN-Nonexistent-Window-7f3b9d2e'; found = $null; nullAsExpected = $false }
  p3_notepad = [ordered]@{
    launched = $false; windowFound = $false; windowName = $null; className = $null
    controlType = $null; valuePatternOk = $false; textPatternOk = $false
    setValueOk = $false; readBackOk = $false; readBackMatches = $false; clearedOk = $false
    closedOk = $false; gapReason = $null
  }
  p5_subtreeAndFallback = [ordered]@{
    ran = $false; nodeCount = 0; nodes = @()
    valuePatternCandidates = 0; textPatternCandidates = 0
    fallbackValueWriteOk = $false; fallbackReadBackMatches = $false
    fallbackClearedOk = $false
    sendKeysAttempted = $false; sendKeysOk = $false
    winnerLane = $null; note = $null
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
  $result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutFile -Encoding utf8
  Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
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
$np = $null
try {
  $proc = Start-Process -FilePath 'notepad.exe' -PassThru -ErrorAction Stop
  $script:result.p3_notepad.launched = $true
  Start-Sleep -Milliseconds 2500

  # locate the Notepad window — legacy (className=Notepad) or modern (name contains Notepad)
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
}

# ---------- P5 (v2): subtree dump + pattern-candidate retry + SendKeys fallback ----------
if ($np -and -not $script:result.p3_notepad.readBackMatches) {
  $p5 = $script:result.p5_subtreeAndFallback
  $p5.ran = $true
  try {
    $all = $np.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $p5.nodeCount = $all.Count
    $nodes = @()
    $maxN = [Math]::Min($all.Count, 150)
    for ($i = 0; $i -lt $maxN; $i++) {
      $el = $all.Item($i)
      $pnames = @()
      try {
        foreach ($pat in $el.GetSupportedPatterns()) {
          $pnames += [System.Windows.Automation.Automation]::PatternName($pat)
        }
      } catch {}
      if ($pnames -contains 'Value Pattern') { $p5.valuePatternCandidates++ }
      if ($pnames -contains 'Text Pattern')  { $p5.textPatternCandidates++ }
      $nm = $el.Current.Name
      if ($nm.Length -gt 60) { $nm = $nm.Substring(0, 60) }
      $nodes += [ordered]@{
        idx         = $i
        name        = $nm
        className   = $el.Current.ClassName
        controlType = $el.Current.ControlType.ProgrammaticName
        patterns    = $pnames
      }
    }
    $p5.nodes = $nodes

    # Fallback lane A: any descendant with a usable ValuePattern
    for ($i = 0; $i -lt $maxN -and -not $p5.fallbackValueWriteOk; $i++) {
      $el = $all.Item($i)
      $vpx = $null
      try { $vpx = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
      if ($vpx) {
        try {
          $vpx.SetValue($marker)
          $back = $vpx.Current.Value
          $p5.fallbackValueWriteOk = $true
          $p5.fallbackReadBackMatches = ($back -eq $marker)
          $vpx.SetValue('')
          $p5.fallbackClearedOk = ($vpx.Current.Value -eq '')
          $p5.winnerLane = "descendant[$i] $($el.Current.ControlType.ProgrammaticName) class=$($el.Current.ClassName) via ValuePattern"
        } catch {
          $p5.note = "candidate[$i] ValuePattern write failed: $($_.Exception.Message)"
        }
      }
    }

    # Fallback lane B: zero-dependency SendKeys (Focus + keystrokes) when no ValuePattern writer exists
    if (-not $p5.fallbackValueWriteOk) {
      $p5.sendKeysAttempted = $true
      try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        try { $np.SetFocus() } catch {}
        Start-Sleep -Milliseconds 400
        [System.Windows.Forms.SendKeys]::SendWait($marker)
        Start-Sleep -Milliseconds 500
        # read back via any TextPattern-bearing descendant
        $readok = $false
        for ($i = 0; $i -lt $maxN -and -not $readok; $i++) {
          $el = $all.Item($i)
          $tpx = $null
          try { $tpx = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch {}
          if ($tpx) {
            try {
              $txt = $tpx.DocumentRange.GetText(4096)
              if ($txt -like "*$marker*") {
                $readok = $true
                $p5.sendKeysOk = $true
                $p5.winnerLane = "SendKeys -> descendant[$i] $($el.Current.ControlType.ProgrammaticName) class=$($el.Current.ClassName) via TextPattern readback"
                # clear what we typed
                try { $np.SetFocus() } catch {}
                [System.Windows.Forms.SendKeys]::SendWait('^a')
                Start-Sleep -Milliseconds 150
                [System.Windows.Forms.SendKeys]::SendWait('{DEL}')
              }
            } catch {}
          }
        }
      } catch {
        $p5.note = "SendKeys lane failed: $($_.Exception.Message)"
      }
    }
  } catch {
    $p5.note = "subtree dump failed: $($_.Exception.Message)"
  }
}

# P6: WinForms controlled fixture — a real desktop app with zero external dependencies.
# Drives a classic TextBox via UIA ValuePattern: the core capability question answered on real
# Windows even though modern UWP-style Notepad exposes no text patterns (P3/P5 gap evidence).
$p6 = [ordered]@{
  ran = $true; formShown = $false; windowFound = $false; editFound = $false
  editControlType = $null; valuePatternOk = $false; setValueOk = $false
  readBackOk = $false; readBackMatches = $false; clearedOk = $false; note = $null
}
try {
  Add-Type -AssemblyName System.Windows.Forms
  $p6marker = "MAJIN-P6-" + ([guid]::NewGuid().ToString("N").Substring(0,8))
  $p6win = "MAJIN-P6-FIXTURE-" + (Get-Random)
  $s6 = [Hashtable]::Synchronized(@{ close = $false; shown = $false })
  $th = New-Object System.Threading.Thread ({
      param($w,$m,$s)
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.Text = $w; $form.Name = $m
      $form.TopMost = $true
      $form.Width = 480; $form.Height = 200
      $tb = New-Object System.Windows.Forms.TextBox
      $tb.Name = "MAJINProbeEdit"
      $tb.Multiline = $true
      $tb.Dock = [System.Windows.Forms.DockStyle]::Fill
      $form.Controls.Add($tb)
      $form.Add_Shown({ $s.shown = $true; $tb.Focus() })
      $timer = New-Object System.Windows.Forms.Timer
      $timer.Interval = 250
      $timer.Add_Tick({ if ($s.close) { $timer.Stop(); $form.Close() } })
      $timer.Start()
      [System.Windows.Forms.Application]::Run($form)
    })
  $th.SetApartmentState([System.Threading.ApartmentState]::STA)
  $th.Start(@($p6win, $p6marker, $s6))
  for ($i=0; $i -lt 40 -and -not $s6.shown; $i++) { Start-Sleep -Milliseconds 250 }
  $p6.formShown = [bool]$s6.shown
  if ($s6.shown) {
    $w6 = $null
    for ($i=0; $i -lt 40 -and -not $w6; $i++) {
      $w6 = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children,
        (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $p6win)))
      if (-not $w6) { Start-Sleep -Milliseconds 250 }
    }
    if ($w6) {
      $p6.windowFound = $true
      $e6 = $null
      $condEdit = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
      for ($i=0; $i -lt 20 -and -not $e6; $i++) {
        $e6 = $w6.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condEdit)
        if (-not $e6) { Start-Sleep -Milliseconds 200 }
      }
      if ($e6) {
        $p6.editFound = $true
        $p6.editControlType = $e6.Current.ControlType.ProgrammaticName
        try {
          $s6p = [System.Windows.Automation.ValuePattern]::Pattern
          $v6 = $e6.GetCurrentPattern($s6p)
        } catch { $v6 = $null }
        if ($v6) {
          $p6.valuePatternOk = $true
          try {
            $e6.SetFocus() | Out-Null
            $v6.SetValue($p6marker)
            $p6.setValueOk = $true
            $p6.readBackOk = $true
            $p6.readBackMatches = ($v6.Current.Value -eq $p6marker)
            if ($p6.readBackMatches) {
              $v6.SetValue("")
              $p6.clearedOk = ($v6.Current.Value -eq "")
            }
          } catch { $p6.note = "value lane: $($_.Exception.Message)" }
        } else { $p6.note = "Edit found but no ValuePattern" }
      } else { $p6.note = "no Edit descendant under fixture window" }
    } else { $p6.note = "fixture window not found in UIA root" }
    $s6.close = $true
    Start-Sleep -Milliseconds 600
  } else { $p6.note = "fixture form never reached Shown state" }
} catch { $p6.note = "P6 lane exception: $($_.Exception.Message)" }
$script:result.p6_winformsFixture = $p6

# cleanup notepad
if ($proc -and -not $proc.HasExited) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop; $script:result.p3_notepad.closedOk = $true } catch { $script:result.p3_notepad.closedOk = $false }
} elseif ($proc) { $script:result.p3_notepad.closedOk = $true }

$script:result.capabilities.locateControls = $script:result.capabilities.locateControls -or ($script:result.p5_subtreeAndFallback.nodeCount -gt 0)
$script:result.capabilities.textInput = $script:result.p3_notepad.setValueOk -or $script:result.p5_subtreeAndFallback.fallbackValueWriteOk -or $script:result.p5_subtreeAndFallback.sendKeysOk -or $script:result.p6_winformsFixture.setValueOk
$script:result.capabilities.readBack  = $script:result.p3_notepad.readBackMatches -or $script:result.p5_subtreeAndFallback.fallbackReadBackMatches -or $script:result.p5_subtreeAndFallback.sendKeysOk -or $script:result.p6_winformsFixture.readBackMatches

$result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutFile -Encoding utf8
Write-Output ($result | ConvertTo-Json -Depth 10)
exit 0
