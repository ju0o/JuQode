<#
.SYNOPSIS
  JuQode WBS-00 / WBS-01 verification on a REAL Windows 10 (1809+) or Windows 11 host.

.DESCRIPTION
  One command collects every piece of evidence WBS-01 acceptance needs, plus the
  Windows-specific WBS-00 spike work that cannot be executed on Linux.

  This harness does not infer anything. Every line it writes is the result of a command
  it ran on this machine. Where something cannot be determined it writes NOT TESTED,
  never a guess.

.NOTES
  Run from the repository root in a NORMAL (non-elevated) PowerShell 5.1+ or 7+:

      pwsh -ExecutionPolicy Bypass -File scripts\verify-windows.ps1

  Output:  docs\dev-evidence\wbs-01\windows\<edition>-<build>\
           report.json, report.md, screenshots, raw logs.

  Requires: Node 18+ and npm on PATH, and a desktop session (this launches a real window).
  Does NOT require: admin rights, a signing certificate, or network access after `npm ci`.
#>
[CmdletBinding()]
param(
  [switch]$SkipInstall,      # reuse an existing node_modules
  [switch]$SkipPackage,      # skip electron-builder (slow)
  [int]$BootRuns = 5
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

# ---------------------------------------------------------------- host identity
$os      = Get-CimInstance Win32_OperatingSystem
$cs      = Get-CimInstance Win32_ComputerSystem
$cv      = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$build   = [int]$cv.CurrentBuildNumber
$ubr     = if ($cv.PSObject.Properties['UBR']) { $cv.UBR } else { 0 }
$product = $cv.ProductName
$display = if ($cv.PSObject.Properties['DisplayVersion']) { $cv.DisplayVersion } else { $cv.ReleaseId }

# Windows 11 reports ProductName "Windows 10" — build number is the only reliable signal.
$family = if ($build -ge 22000) { 'Windows 11' } elseif ($build -ge 17763) { 'Windows 10 (1809+)' } else { 'Windows (below 1809 — OUT OF TARGET)' }
$isServer = $os.ProductType -ne 1     # 1 = workstation
$targetOk = ($build -ge 17763) -and (-not $isServer)

$slug = ('{0}-{1}' -f ($family -replace '[^A-Za-z0-9]', ''), $build)
$Out  = Join-Path $Root "docs\dev-evidence\wbs-01\windows\$slug"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$RawDir = Join-Path $Out 'raw'; New-Item -ItemType Directory -Force -Path $RawDir | Out-Null

$R = [ordered]@{}
$R.harnessVersion = '1.0.0'
$R.utc = (Get-Date).ToUniversalTime().ToString('o')
$R.host = [ordered]@{
  productName   = $product
  displayVersion= $display
  build         = "$build.$ubr"
  family        = $family
  isServerSku   = $isServer
  isTargetOs    = $targetOk
  architecture  = $env:PROCESSOR_ARCHITECTURE
  osArchitecture= $os.OSArchitecture
  cpu           = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
  ramGB         = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  powershell    = $PSVersionTable.PSVersion.ToString()
}

Write-Host "`n=== JuQode Windows verification ===" -ForegroundColor Cyan
Write-Host "  $product ($family) build $build.$ubr  $($os.OSArchitecture)"
if ($isServer) {
  Write-Warning "This is a SERVER SKU. Per the acceptance rule it MUST NOT be reported as Windows 10/11 client validation. Results will be marked supplemental."
}
if (-not $targetOk) { Write-Warning "This host is OUTSIDE the approved target OS (D-125)." }

# Processes belonging to THIS checkout only. `Get-Process -Name electron` is machine-wide and
# would count any other Electron app the developer happens to be running.
function Get-JuQodeProcesses {
  $mine = @()
  $mine += @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $Root 'node_modules\electron'), 'OrdinalIgnoreCase') })
  $mine += @(Get-CimInstance Win32_Process -Filter "Name='JuQode.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $Root 'dist'), 'OrdinalIgnoreCase') })
  $mine
}

# Killing the `cmd.exe` shim that Start-Process gave us leaves the real electron.exe running —
# that is the leak this harness reported. /T is the documented tree analogue on Windows.
function Stop-Tree { param([int]$ProcessId)
  & taskkill /PID $ProcessId /T /F 2>&1 | Out-Null
}

# A survivor from step N makes step N+1 fail for the wrong reason: the app takes a
# single-instance lock, so a stray Electron makes the NEXT launch quit silently at startup.
# Sweep between steps, but RECORD what was swept — a leak stays a reported failure.
$Leaks = @()
function Sweep { param([string]$After)
  $p = @(Get-JuQodeProcesses)
  if ($p.Count -gt 0) {
    $script:Leaks += [ordered]@{ after = $After; count = $p.Count; pids = @($p.ProcessId) }
    Write-Host "    LEAK: $($p.Count) process(es) survived '$After' — killing" -ForegroundColor Red
    foreach ($x in $p) { Stop-Tree $x.ProcessId }
    Start-Sleep -Seconds 2
  }
}

function Step { param([string]$Name, [scriptblock]$Body)
  Write-Host "`n--- $Name" -ForegroundColor Yellow
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try   { $v = & $Body; $sw.Stop(); return [ordered]@{ status='PASS'; ms=$sw.ElapsedMilliseconds; result=$v } }
  catch { $sw.Stop(); Write-Host "    FAIL: $_" -ForegroundColor Red
          return [ordered]@{ status='FAIL'; ms=$sw.ElapsedMilliseconds; error="$_" } }
}

# ---------------------------------------------------------------- toolchain
$R.toolchain = Step 'toolchain' {
  $node = (& node --version) 2>&1
  $npm  = (& npm --version) 2>&1
  [ordered]@{ node="$node"; npm="$npm"; nodePath=(Get-Command node).Source }
}

# ---------------------------------------------------------------- clean install
if (-not $SkipInstall) {
  $R.install = Step 'npm ci (clean)' {
    if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
    & npm ci --no-audit --no-fund 2>&1 | Tee-Object (Join-Path $RawDir 'npm-ci.log') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm ci exited $LASTEXITCODE" }
    # Electron 42+ has no postinstall; the binary is fetched lazily. Force it now so a
    # later offline claim is not silently satisfied by a download.
    & node node_modules\electron\install.js 2>&1 | Tee-Object (Join-Path $RawDir 'electron-install.log') | Out-Null
    $exe = 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $exe)) { throw "electron binary missing after explicit install: $exe" }
    [ordered]@{ electronExe=$exe; sizeBytes=(Get-Item $exe).Length }
  }
}

$R.versions = Step 'runtime versions (from the running process)' {
  $j = & node_modules\.bin\electron.cmd --version 2>&1
  [ordered]@{ electronCli="$j" }
}

# ---------------------------------------------------------------- tests
# `npm test` is unit AND e2e; running it here would run the e2e suite twice and report the
# result of one step under the name of another.
$R.unitTests = Step 'npm run test:unit' {
  $o = & npm run test:unit 2>&1 | Tee-Object (Join-Path $RawDir 'unit.log')
  $pass = ([regex]'# pass (\d+)').Match(($o -join "`n")).Groups[1].Value
  $fail = ([regex]'# fail (\d+)').Match(($o -join "`n")).Groups[1].Value
  if ([int]$pass -lt 1) { throw "no unit tests ran (pass=$pass)" }
  if ([int]$fail -gt 0) { throw "$fail unit test(s) failed" }
  [ordered]@{ pass=[int]$pass; fail=[int]$fail }
}

$R.e2eTests = Step 'npm run test:e2e' {
  $o = & npm run test:e2e 2>&1 | Tee-Object (Join-Path $RawDir 'e2e.log')
  if ($LASTEXITCODE -ne 0) { throw "e2e exited $LASTEXITCODE" }
  [ordered]@{ output=($o | Select-Object -Last 40) -join "`n" }
}

# ---------------------------------------------------------------- boot on the real OS
$R.boot = Step "packaged-equivalent boot x$BootRuns (dev mode)" {
  $runs = @()
  for ($i = 0; $i -lt $BootRuns; $i++) {
    $env:JUQODE_TRACE = '1'; $env:JUQODE_EXIT_AFTER_LOAD = '1'
    $log = Join-Path $RawDir "boot-$i.jsonl"
    $t0 = Get-Date
    & node_modules\.bin\electron.cmd . 2>&1 | Tee-Object $log | Out-Null
    $code = $LASTEXITCODE
    $wall = [int]((Get-Date) - $t0).TotalMilliseconds
    $ev = @{}
    Get-Content $log | ForEach-Object {
      try { $o = $_ | ConvertFrom-Json; if ($o.ev) { $ev[$o.ev] = $o } } catch {}
    }
    $runs += [ordered]@{
      exitCode = $code
      wallMs   = $wall
      appReadyMs        = if ($ev['app.ready'])        { $ev['app.ready'].ms }        else { $null }
      didFinishLoadMs   = if ($ev['did-finish-load'])  { $ev['did-finish-load'].ms }  else { $null }
      windowShownMs     = if ($ev['window.shown'])     { $ev['window.shown'].ms }     else { $null }
      shownVia          = if ($ev['window.shown'])     { $ev['window.shown'].via }    else { $null }
      windows           = if ($ev['did-finish-load'])  { $ev['did-finish-load'].windows } else { $null }
      externalRequests  = if ($ev['did-finish-load'])  { $ev['did-finish-load'].externalRequests } else { $null }
    }
  }
  Remove-Item Env:JUQODE_EXIT_AFTER_LOAD -ErrorAction SilentlyContinue
  $bad = $runs | Where-Object { $_.windows -ne 1 -or $_.externalRequests -ne 0 -or $_.exitCode -ne 0 }
  if ($bad) { throw "boot invariants violated on $($bad.Count) run(s)" }
  $loads = ($runs | ForEach-Object { $_.didFinishLoadMs }) | Sort-Object
  [ordered]@{
    runs = $runs
    windowsAlwaysOne = $true
    externalRequestsAlwaysZero = $true
    didFinishLoadMs = [ordered]@{ min=$loads[0]; median=$loads[[int]($loads.Count/2)]; max=$loads[-1] }
  }
}

# ---------------------------------------------------------------- SC-01 + themes over CDP
$R.sc01 = Step 'SC-01 render + theme matrix + screenshots (CDP)' {
  $env:JUQODE_TRACE = '1'
  $proc = Start-Process -PassThru -FilePath 'node_modules\.bin\electron.cmd' `
            -ArgumentList '.', '--remote-debugging-port=9223' -WindowStyle Normal
  Start-Sleep -Seconds 6
  try {
    $r = & node scripts\windows-cdp-probe.mjs 2>&1 | Tee-Object (Join-Path $RawDir 'cdp.log')
    $json = ($r -join "`n")
    $i = $json.IndexOf('{'); if ($i -lt 0) { throw "probe produced no JSON: $json" }
    $parsed = $json.Substring($i) | ConvertFrom-Json
    # move screenshots next to this report
    Get-ChildItem -Path (Join-Path $Root 'tmp-visual') -Filter '*.png' -ErrorAction SilentlyContinue |
      ForEach-Object { Move-Item $_.FullName (Join-Path $Out $_.Name) -Force }
    $parsed
  } finally {
    if (-not $proc.HasExited) { Stop-Tree $proc.Id }
    Start-Sleep -Seconds 2
    Sweep 'SC-01 CDP probe'
  }
}

# ---------------------------------------------------------------- packaging + real launch
if (-not $SkipPackage) {
  $R.packaging = Step 'electron-builder --win + LAUNCH the produced exe' {
    & npx electron-builder --win dir nsis --x64 2>&1 | Tee-Object (Join-Path $RawDir 'build-win.log') | Out-Null
    $exe = 'dist\win-unpacked\JuQode.exe'
    if (-not (Test-Path $exe)) { throw "no packaged exe at $exe" }

    # PE creation is not launch. Actually run it.
    $env:JUQODE_TRACE = '1'; $env:JUQODE_EXIT_AFTER_LOAD = '1'
    $log = Join-Path $RawDir 'packaged-boot.jsonl'
    & $exe 2>&1 | Tee-Object $log | Out-Null
    $code = $LASTEXITCODE
    Remove-Item Env:JUQODE_EXIT_AFTER_LOAD -ErrorAction SilentlyContinue
    $ev = @{}; Get-Content $log | ForEach-Object { try { $o=$_|ConvertFrom-Json; if($o.ev){$ev[$o.ev]=$o} } catch {} }
    if (-not $ev['did-finish-load']) {
      # The commonest cause is not the build: a surviving Electron from an earlier step holds
      # the single-instance lock, so this process quits at startup and traces nothing.
      $n = @(Get-JuQodeProcesses).Count
      throw ("packaged exe never finished loading (exit $code, $($ev.Keys.Count) trace event(s), " +
             "$n JuQode/electron process(es) alive). First lines: " +
             (((Get-Content $log -TotalCount 5) -join ' | ')))
    }

    # signing: read the PE certificate table, never the builder log
    $sig = Get-AuthenticodeSignature $exe
    $installer = Get-ChildItem dist -Filter '*.exe' -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -like '*Setup*' } | Select-Object -First 1

    [ordered]@{
      unpackedExe       = $exe
      unpackedLaunched  = $true
      packagedExitCode  = $code
      packagedWindows   = $ev['did-finish-load'].windows
      packagedExternal  = $ev['did-finish-load'].externalRequests
      packagedLoadMs    = $ev['did-finish-load'].ms
      installerBuilt    = [bool]$installer
      installerName     = if ($installer) { $installer.Name } else { $null }
      installerBytes    = if ($installer) { $installer.Length } else { $null }
      signatureStatus   = $sig.Status.ToString()
      signerCertificate = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
      signed            = ($sig.Status -eq 'Valid')
    }
  }
  Sweep 'packaged launch'
}

# ---------------------------------------------------------------- WBS-00 Windows spikes
$R.spikes = Step 'WBS-00 Windows spikes (ConPTY + process lifecycle)' {
  $o = & node scripts\windows-spikes.mjs 2>&1 | Tee-Object (Join-Path $RawDir 'spikes.log')
  $p = Join-Path $RawDir 'spikes.json'
  if (Test-Path $p) { Get-Content $p -Raw | ConvertFrom-Json }
  else { throw ("spikes produced no JSON (node exited $LASTEXITCODE). Last output: " +
                (($o | Select-Object -Last 6) -join ' | ')) }
}

# ---------------------------------------------------------------- orphan check
$R.orphans = Step 'no JuQode process survives' {
  Start-Sleep -Seconds 3
  $p = @(Get-JuQodeProcesses)
  foreach ($x in $p) { Stop-Tree $x.ProcessId }   # never leave the developer's machine dirty
  if ($p.Count -gt 0) { throw "$($p.Count) JuQode/electron process(es) still running (pids $($p.ProcessId -join ', '))" }
  if ($Leaks.Count -gt 0) { throw "no survivor at the end, but $($Leaks.Count) step(s) leaked: $(($Leaks | ForEach-Object { $_.after }) -join ', ')" }
  [ordered]@{ remaining = 0; leaksDuringRun = @() }
}
$R.leaks = $Leaks

# ---------------------------------------------------------------- verdict
# `$R` also holds plain records (host, leaks) that are dictionaries WITHOUT a status. Under
# Set-StrictMode -Version Latest, reading `.status` off one of those is a terminating error —
# which is how a completed run used to die at the very last step. Ask before reading.
$fails = @($R.Keys | Where-Object {
  $v = $R[$_]
  $v -is [System.Collections.IDictionary] -and $v.Contains('status') -and $v['status'] -eq 'FAIL'
})
$R.verdict = [ordered]@{
  targetOsValidated = $targetOk -and (-not $isServer) -and ($fails.Count -eq 0)
  osFamily          = $family
  isServerSku       = $isServer
  supplementalOnly  = $isServer
  failedSteps       = $fails
  note = if ($isServer) {
    'SERVER SKU — supplemental regression evidence only. MUST NOT be reported as Windows 10/11 client validation.'
  } elseif (-not $targetOk) { 'Host is outside the approved target OS (D-125).' }
  else { 'Client Windows target host.' }
}

$R | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $Out 'report.json') -Encoding utf8

$md = @()
$md += "# JuQode — Windows verification"
$md += ""
$md += "| | |"
$md += "|---|---|"
$md += "| Host | $product ($family) build $build.$ubr $($os.OSArchitecture) |"
$md += "| Server SKU | $isServer |"
$md += "| Target OS (D-125) | $targetOk |"
$md += "| Harness | scripts/verify-windows.ps1 v$($R.harnessVersion) |"
$md += "| Run (UTC) | $($R.utc) |"
$md += ""
foreach ($k in $R.Keys) {
  if ($R[$k] -is [System.Collections.IDictionary] -and $R[$k].Contains('status')) {
    $md += "- **$k** — $($R[$k].status) ($($R[$k].ms) ms)"
  }
}
$md += ""
$md += "Full machine-readable result: ``report.json``. Raw logs: ``raw/``."
$md -join "`n" | Set-Content (Join-Path $Out 'report.md') -Encoding utf8

Write-Host "`n=== Done. Evidence: $Out" -ForegroundColor Green
Write-Host ("verdict.targetOsValidated = {0}" -f $R.verdict.targetOsValidated)
if ($fails.Count) { Write-Host "FAILED STEPS: $($fails -join ', ')" -ForegroundColor Red }
Pop-Location
if ($fails.Count) { exit 1 } else { exit 0 }
