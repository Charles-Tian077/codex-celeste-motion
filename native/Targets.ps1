function Find-MotionApplication([string]$Target, [string]$Application) {
    if ($Application) {
        $file = Resolve-Path -LiteralPath $Application
        if ([IO.Path]::GetExtension($file.Path) -ne '.exe') { throw 'Select the actual desktop application executable.' }
        if ($Target -eq 'Doubao') {
            $main = Join-Path (Split-Path -Parent $file.Path) 'app\Doubao.exe'
            if ([IO.File]::Exists($main)) { return $main }
        }
        return $file.Path
    }

    $products = @{
        DeepSeek = @{ name = 'DeepSeek.*Harness'; folders = @('DeepSeek Harness','DeepSeekHarness','deepseek-harness'); files = @('DeepSeek Harness.exe','deepseek-harness.exe','dsh-desktop.exe') }
        Qwen = @{ name = 'Qwen.*Code'; folders = @('Qwen Code Desktop','Qwen Code','Qwen-Code-Desktop'); files = @('Qwen Code Desktop.exe','Qwen-Code-Desktop.exe','qwen-code-desktop.exe') }
        Doubao = @{ name = '^(\u8c46\u5305|Doubao)$'; folders = @('Doubao','Doubao\Application'); files = @('app\Doubao.exe','Doubao.exe') }
    }
    $product = $products[$Target]
    $registry = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $roots = @(foreach ($item in (Get-ItemProperty $registry -ErrorAction SilentlyContinue | Where-Object DisplayName -Match $product.name)) {
        if ($item.InstallLocation) { $item.InstallLocation.Trim('"') }
        foreach ($value in $item.DisplayIcon,$item.UninstallString) {
            if ($value -and $value -match '(?i)^\s*"?([a-z]:\\.+?\.(?:exe|ico))(?:"|,|\s|$)') {
                Split-Path -Parent $Matches[1]
            }
        }
    })
    $locations = @((Join-Path $env:LOCALAPPDATA 'Programs'),$env:LOCALAPPDATA,$env:ProgramFiles)
    foreach ($location in $locations) {
        if (-not $location) { continue }
        $roots += @($product.folders | ForEach-Object { Join-Path $location $_ })
    }
    foreach ($root in ($roots | Select-Object -Unique)) {
        foreach ($name in $product.files) {
            $candidate = Join-Path $root $name
            if ([IO.File]::Exists($candidate)) { return $candidate }
        }
    }
    throw "Install the $Target desktop application, or pass -Application with the full path of its executable."
}
