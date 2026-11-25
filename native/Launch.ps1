[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('DeepSeek','Qwen','Doubao')]
    [string]$Target,
    [switch]$Console
)

$ErrorActionPreference='Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($Target+'.json')) -Raw | ConvertFrom-Json
$application = [IO.Path]::GetFullPath($config.application)
$base = Split-Path -Parent $PSScriptRoot
$state = Join-Path $PSScriptRoot ($Target+'-running.json')
$result = Join-Path $PSScriptRoot ($Target+'-theme.json')
$profile = Join-Path $PSScriptRoot ($Target+'-profile')
$controller = Join-Path $PSScriptRoot 'attach.mjs'
$gate = [Threading.Mutex]::new($false, ('Local\CelesteMotion-' + $Target))
$locked = $false
$failure = $null

function Get-RunningMotion {
    if (-not [IO.File]::Exists($state)) { return }
    try {
        $record = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
        $app = Get-Process -Id ([int]$record.processId) -ErrorAction Stop
        $port = [int]$record.port
        if ($port -ge 1 -and $port -le 65535 -and $app.Path -eq $application -and $app.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.started) {
            return [pscustomobject]@{ Process=$app; Port=$port }
        }
    } catch {}
}

function Test-RunningHelper {
    if (-not [IO.File]::Exists($result)) { return $false }
    try { $ready = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json } catch { return $false }
    if (-not $ready.ok) { return $false }
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    return [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe' AND SessionId=$session" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($controller) -and $_.CommandLine.Contains($result) } |
        Select-Object -First 1)
}

function Test-Owner([int]$Candidate, [int]$Root) {
    for ($distance=0; $Candidate -gt 0 -and $distance -lt 10; $distance++) {
        if ($Candidate -eq $Root) { return $true }
        $item = Get-CimInstance Win32_Process -Filter "ProcessId=$Candidate" -ErrorAction SilentlyContinue
        if (-not $item) { return $false }
        $Candidate = [int]$item.ParentProcessId
    }
    return $false
}

function Wait-ForListener([int]$Port, $App) {
    $stop = [DateTime]::UtcNow.AddSeconds(16)
    do {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        foreach ($server in $listeners) {
            if ($server.LocalAddress -notin '127.0.0.1','::1' -or -not (Test-Owner $server.OwningProcess $App.Id)) {
                throw 'The media helper requires a loopback listener owned by this desktop application.'
            }
        }
        if ('127.0.0.1' -in $listeners.LocalAddress) { return }
        Start-Sleep -Milliseconds 110
    } while ([DateTime]::UtcNow -lt $stop -and -not $App.HasExited)
    throw "The $Target desktop build did not open its local renderer. Exit any already running copy, then open the Motion shortcut again."
}

function Find-Node {
    $bundled = Join-Path $base 'runtime\node.exe'
    if ([IO.File]::Exists($bundled)) { return $bundled }
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed -and (& $installed.Source --version) -match '^v(2[2-9]|[3-9][0-9])\.') { return $installed.Source }
    $codex = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
    if ($codex) {
        $renderer = Join-Path $codex.InstallLocation 'app\resources\cua_node\bin\node.exe'
        if ([IO.File]::Exists($renderer) -and (& $renderer --version) -match '^v(2[2-9]|[3-9][0-9])\.') { return $renderer }
    }
    throw 'Install Node.js 22 or newer to use this desktop adapter.'
}

try {
    try { $locked=$gate.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
    if (-not $locked) { return }
    if (-not [IO.File]::Exists($application)) { throw "The $Target executable moved. Run the corresponding installer again." }
    $node = Find-Node
    $null = [Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot 'WindowIdentity.dll'))
    $running = Get-RunningMotion
    if ($running) {
        $app = $running.Process
        $port = $running.Port
        $handle = [CodexMotionWindow]::Find($app.Id)
        if ($handle -ne [IntPtr]::Zero) { [CodexMotionWindow]::Restore($handle,$app.Id) }
        if (Test-RunningHelper) { return }
    } else {
        $reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
        try { $reservation.Start(); $port=$reservation.LocalEndpoint.Port } finally { $reservation.Stop() }
        $null = [IO.Directory]::CreateDirectory($profile)
        $debug = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port"
        $start = [Diagnostics.ProcessStartInfo]::new($application)
        $start.WorkingDirectory = Split-Path -Parent $application
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        if ($Target -eq 'Qwen') {
            $start.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = $debug
            $start.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $profile
        } else {
            $start.Arguments = $debug + ' "--user-data-dir=' + $profile + '" --no-first-run'
        }
        $app = [Diagnostics.Process]::Start($start)
    }
    Wait-ForListener $port $app
    if (-not $running) {
        ([ordered]@{processId=$app.Id;started=$app.StartTime.ToUniversalTime().Ticks.ToString();port=$port} | ConvertTo-Json -Compress) |
            Set-Content -LiteralPath $state -Encoding ascii
    }
    if ([IO.File]::Exists($result)) { [IO.File]::Delete($result) }
    $helper = [Diagnostics.ProcessStartInfo]::new($node)
    $helper.Arguments = '--max-old-space-size=48 "{0}" {1} {2} "{3}" "{4}"' -f $controller,$port,$Target,(Join-Path $base 'skin'),$result
    $helper.UseShellExecute = $false
    $helper.CreateNoWindow = $true
    $helperProcess = [Diagnostics.Process]::Start($helper)
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        if ([IO.File]::Exists($result)) {
            try { $status=Get-Content -LiteralPath $result -Raw | ConvertFrom-Json } catch { $status=$null }
            if ($status.ok) { "$Target motion renderer is ready."; return }
            if ($status.error) { throw $status.error }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline -and -not $helperProcess.HasExited)
    throw "The $Target workbench did not accept the motion theme."
} catch {
    $failure = $_.Exception.Message
    if ($Console) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    $null = [Windows.Forms.MessageBox]::Show($failure, 'Celeste Motion')
} finally {
    if ($locked) { $gate.ReleaseMutex() }
    $gate.Dispose()
}
if ($failure) { exit 1 }
