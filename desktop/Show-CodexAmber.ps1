[CmdletBinding(DefaultParameterSetName='Launch')]
param(
    [Parameter(ParameterSetName='Verify')][switch]$Verify,
    [Parameter(ParameterSetName='Refresh')][switch]$Refresh
)

$ErrorActionPreference = 'Stop'
$family = 'OpenAI.Codex_2p2nqsd0c76g0'
$package = Get-AppxPackage -Name OpenAI.Codex | Where-Object PackageFamilyName -eq $family
if (-not $package) { throw 'The Windows Codex package is not installed.' }

$executable = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
$executionAlias = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\$family\chatgpt-desktop.exe"
$node = Join-Path $package.InstallLocation 'app\resources\cua_node\bin\node.exe'
$themeRoot = Join-Path $env:LOCALAPPDATA 'CodexAmberMotion'
$profile = Join-Path $themeRoot 'motion-profile'
$controller = Join-Path $PSScriptRoot 'connect.mjs'
$media = Join-Path $PSScriptRoot 'skin'
$revision = 29
$null = [Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot 'WindowIdentity.dll'))

function Wait-ForLocalDebugger([int]$Port, [Diagnostics.Process]$App) {
    $deadline = [DateTime]::UtcNow.AddSeconds(13)
    while ([DateTime]::UtcNow -lt $deadline -and (-not $App.HasExited)) {
        $client = [Net.Sockets.TcpClient]::new()
        try { $connected = $client.ConnectAsync([Net.IPAddress]::Loopback, $Port).Wait(65) -and $client.Connected }
        catch { $connected = $false }
        finally { $client.Dispose() }
        if ($connected) {
            $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
            if ($listeners | Where-Object { $_.OwningProcess -ne $App.Id -or $_.LocalAddress -notin '127.0.0.1','::1' }) {
                throw 'The debugger endpoint is not exclusively on loopback and owned by Codex.'
            }
            if ($listeners.LocalAddress -contains '127.0.0.1') { return }
        }
        Start-Sleep -Milliseconds 35
    }
    throw 'Codex did not open its local renderer endpoint.'
}

function Set-MotionWindowGroup([Diagnostics.Process]$App) {
    $until = [DateTime]::UtcNow.AddSeconds(13)
    while ([DateTime]::UtcNow -lt $until -and (-not $App.HasExited)) {
        $window = [CodexMotionWindow]::Find($App.Id)
        if ($window -ne [IntPtr]::Zero) {
            if ([CodexMotionWindow]::Read($window, $App.Id) -ne [CodexMotionWindow]::AppId) {
                [CodexMotionWindow]::Group($window, $App.Id)
            }
            if ([CodexMotionWindow]::Read($window, $App.Id) -eq [CodexMotionWindow]::AppId) { return $window }
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'The animated Codex window could not be assigned its own taskbar group.'
}

function Find-MotionProcess {
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe' AND SessionId=$session")) {
        if ($process.ExecutablePath -ne $executable -or $process.CommandLine -match '(?:^|\s)--type=|CodexAmberPreview-') { continue }
        if ($process.CommandLine -notmatch '(?:^|\s)--remote-debugging-address=127\.0\.0\.1(?:\s|$)' -or
            $process.CommandLine -notmatch '(?:^|\s)--remote-debugging-port=(\d{1,5})(?:\s|$)') { continue }
        $port = [int]$Matches[1]
        $stateName = '.controller-' + $process.ProcessId + '.json'
        $ownsProfile = $process.CommandLine -match ('--user-data-dir=' + [Regex]::Escape($profile) + '(?:"|\s|$)')
        if ($ownsProfile) {
            return [pscustomobject]@{ Id = $process.ProcessId; Port = $port; State = (Join-Path $PSScriptRoot $stateName) }
        }
    }
}

function Get-ThemeHelper([string]$State, [string]$Script) {
    if (-not (Test-Path -LiteralPath $State -PathType Leaf)) { return }
    try { $record = Get-Content -LiteralPath $State -Raw | ConvertFrom-Json } catch { return }
    if (-not $record.ok -or -not $record.helper) { return }
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.helper)"
    if ($candidate.ExecutablePath -eq $node -and $candidate.CommandLine -and
        $candidate.CommandLine.Contains($Script) -and $candidate.CommandLine.Contains($State)) {
        [pscustomobject]@{ Process = (Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue); Revision = $record.revision }
    }
}

$mutexName = if ($Verify) { 'Local\CodexAmberMotionVerify' } else { 'Local\CodexAmberMotionLaunch' }
$mutex = [Threading.Mutex]::new($false, $mutexName)
$locked = $false
$scratch = $null
$app = $null
$verifier = $null
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) {
        if (-not $Refresh -and -not $Verify) { return }
        throw 'A theme launch is already in progress.'
    }

    $running = if (-not $Verify) { Find-MotionProcess }
    if ($Refresh -and -not $running) { throw 'No running Codex motion window is available to refresh.' }
    if ($running) {
        $app = Get-Process -Id $running.Id
        $port = $running.Port
        $helper = Get-ThemeHelper $running.State $controller
        if (-not $helper) {
            $previous = Join-Path $themeRoot 'window-theme-optimized'
            $previousState = Join-Path $previous ([IO.Path]::GetFileName($running.State))
            $helper = Get-ThemeHelper $previousState (Join-Path $previous 'connect.mjs')
        }
        if (-not $Refresh) {
            $window = [CodexMotionWindow]::Find($app.Id)
            if ($window -ne [IntPtr]::Zero) { [CodexMotionWindow]::Restore($window, $app.Id) }
            if ($helper -and $helper.Process -and $helper.Revision -eq $revision) {
                'Activated the existing Codex motion window.'
                return
            }
        }
        if ($helper -and $helper.Process -and $helper.Revision -eq $revision) { return }
        Wait-ForLocalDebugger $port $app
        if ($helper -and $helper.Process) {
            $helper.Process.Kill()
            if (-not $helper.Process.WaitForExit(2500)) { throw 'The previous theme helper did not quit.' }
        }
        if (Test-Path -LiteralPath $running.State -PathType Leaf) { Remove-Item -LiteralPath $running.State -ErrorAction Stop }
    } else {
        foreach ($file in @($executionAlias, $node, $controller, (Join-Path $PSScriptRoot 'theme.js'), (Join-Path $PSScriptRoot 'theme.css'))) {
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing required file: $file" }
        }
        foreach ($file in 'intro.mp4','background.mp4','background.webp','splash.webp') {
            if (-not (Test-Path -LiteralPath (Join-Path $media $file) -PathType Leaf)) { throw "Missing theme media: $file" }
        }
        $reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        try { $reservation.Start(); $port = $reservation.LocalEndpoint.Port }
        finally { $reservation.Stop() }

        $userData = $profile
        if ($Verify) {
            $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
            $scratch = Join-Path $tempRoot ('CodexAmberPreview-' + [Guid]::NewGuid().ToString('N'))
            $userData = $scratch
        }
        $null = [IO.Directory]::CreateDirectory($userData)
        $start = [Diagnostics.ProcessStartInfo]::new($executionAlias)
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.WorkingDirectory = Split-Path -Parent $executable
        $start.EnvironmentVariables['CODEX_ELECTRON_USER_DATA_PATH'] = $userData
        $start.Arguments = "--no-first-run --remote-debugging-address=127.0.0.1 --remote-debugging-port=$port" + ' "--user-data-dir=' + $userData + '"'
        $start.Arguments += ' "codex://threads/new?mode=codex"'
        $app = [Diagnostics.Process]::Start($start)
        Wait-ForLocalDebugger $port $app
    }

    $statusPath = Join-Path $PSScriptRoot ('.controller-' + $app.Id + '.json')
    $mode = if ($Verify) { 'verify' } elseif ($running) { 'refresh' } else { 'launch' }
    $helperStart = [Diagnostics.ProcessStartInfo]::new($node)
    $helperStart.UseShellExecute = $false
    $helperStart.CreateNoWindow = $true
    $helperStart.WorkingDirectory = $PSScriptRoot
    $helperStart.Arguments = '--max-old-space-size=32 "{0}" {1} "{2}" {3}' -f $controller, $port, $media, $mode
    if ($Verify) {
        $helperStart.RedirectStandardOutput = $true
        $helperStart.RedirectStandardError = $true
    } else {
        $helperStart.Arguments += ' "' + $statusPath + '"'
    }
    $worker = [Diagnostics.Process]::Start($helperStart)
    if ($Verify) {
        $verifier = $worker
        $stdout = $worker.StandardOutput.ReadToEndAsync()
        $stderr = $worker.StandardError.ReadToEndAsync()
    }
    $window = Set-MotionWindowGroup $app
    if ($mode -eq 'launch') { [CodexMotionWindow]::Restore($window, $app.Id) }
    if ($Verify) { 'The isolated native window uses the separate motion taskbar group.' }
    if ($Verify) {
        if (-not $worker.WaitForExit(60000)) { throw 'The isolated theme verification took too long.' }
        if ($stdout.Result) { $stdout.Result.TrimEnd() }
        if ($stderr.Result) { $stderr.Result.TrimEnd() }
        if ($worker.ExitCode -ne 0) { throw 'The isolated theme verification failed.' }
        return
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(22)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
            try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $status = $null }
            if ($status.ok) { 'Claude motion theme is active in Codex.'; return }
            if ($status.message) { throw $status.message }
        }
        if ($worker.HasExited) { throw 'The theme helper exited before attaching.' }
        Start-Sleep -Milliseconds 70
    }
    throw 'The theme helper did not finish starting.'
} finally {
    if ($Verify -and $verifier -and (-not $verifier.HasExited)) { $verifier.Kill() }
    if ($Verify -and $app -and (-not $app.HasExited)) {
        if ($app.CloseMainWindow()) { [void]$app.WaitForExit(1800) }
        if (-not $app.HasExited) { $app.Kill() }
        [void]$app.WaitForExit(2500)
    }
    if ($scratch -and (Test-Path -LiteralPath $scratch -PathType Container)) {
        $resolved = (Resolve-Path -LiteralPath $scratch).Path
        if ((Split-Path -Parent $resolved).TrimEnd('\') -eq $tempRoot.TrimEnd('\') -and
            (Split-Path -Leaf $resolved) -match '^CodexAmberPreview-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
