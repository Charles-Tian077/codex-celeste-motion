[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Desktop','VSCode','DeepSeek','Qwen','Doubao')]
    [string]$Target,
    [switch]$Uninstall,
    [string]$Application,
    [string]$ExtensionPath,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodexAmberMotion'),
    [string]$ShortcutDirectory = [Environment]::GetFolderPath('DesktopDirectory')
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$media = Join-Path $PSScriptRoot 'skin'
$motionFiles = @('intro.mp4','background.mp4','background.webp','splash.webp')
$version = 33
$extensionVersion = '26.1106.51428'

function Set-AtomicFile([string]$Temporary, [string]$Destination) {
    if ([IO.File]::Exists($Destination)) {
        [IO.File]::Replace($Temporary, $Destination, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [IO.File]::Move($Temporary, $Destination)
    }
}

function Copy-VerifiedFile([string]$Source, [string]$Destination) {
    $expected = (Get-FileHash -LiteralPath $Source).Hash
    if ((Test-Path -LiteralPath $Destination -PathType Leaf) -and
        (Get-FileHash -LiteralPath $Destination).Hash -eq $expected) { return }
    $pending = $Destination + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::Copy($Source, $pending)
        if ((Get-FileHash -LiteralPath $pending).Hash -ne $expected) {
            throw "Verification failed for $Source"
        }
        Set-AtomicFile $pending $Destination
    } finally {
        if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
    }
}

function Write-AtomicText([string]$File, [string]$Text) {
    $pending = $File + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($pending, $Text, [Text.UTF8Encoding]::new($false))
        Set-AtomicFile $pending $File
    } finally {
        if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
    }
}

function Test-Assets {
    $manifest = Join-Path $media 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw 'Download and extract the Windows ZIP from the release page. The source archive lacks the video assets.'
    }
    $check = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    foreach ($name in $motionFiles) {
        $file = Join-Path $media $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or
            (Get-FileHash -LiteralPath $file).Hash -ne $check.files.$name) {
            throw "The animation file is missing or damaged: $name"
        }
    }
}

function Install-Assets([string]$Destination) {
    $null = [IO.Directory]::CreateDirectory($Destination)
    foreach ($name in $motionFiles) {
        Copy-VerifiedFile (Join-Path $media $name) (Join-Path $Destination $name)
    }
}

function Find-DesktopPackage {
    $app = Get-AppxPackage -Name OpenAI.Codex | Where-Object PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' |
        Select-Object -First 1
    if (-not $app) { throw 'Install the official Windows Codex app before running this deployment.' }
    return $app
}

function Find-VSCodeExtension {
    if ($ExtensionPath) {
        return (Resolve-Path -LiteralPath $ExtensionPath).Path
    }
    $directory = Join-Path $env:USERPROFILE '.vscode\extensions'
    $candidate = Get-ChildItem -LiteralPath $directory -Directory -Filter 'openai.chatgpt-*' -ErrorAction SilentlyContinue |
        Where-Object Name -Match "^openai\.chatgpt-$([Regex]::Escape($extensionVersion))(?:-|$)" |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Install OpenAI Codex for VS Code $extensionVersion, then run this installer again. Use -ExtensionPath for a custom location."
    }
    return $candidate.FullName
}

function Set-Shortcut([string]$Name, [string]$Script, [string]$Icon, [string]$Arguments = '') {
    $null = [IO.Directory]::CreateDirectory($ShortcutDirectory)
    $link = Join-Path $ShortcutDirectory ($Name + '.lnk')
    $shell = New-Object -ComObject WScript.Shell
    try {
        $entry = $shell.CreateShortcut($link)
        if ([IO.File]::Exists($link) -and $entry.Arguments -notlike ('*"' + $Script + '"*')) {
            throw "A different shortcut already exists at $link"
        }
        $entry.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $entry.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '" ' + $Arguments
        $entry.WorkingDirectory = Split-Path -Parent $Script
        $entry.IconLocation = $Icon + ',0'
        $entry.Description = 'Celeste Motion'
        $entry.Save()
    } finally {
        if ($entry) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($entry) }
        $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
    return $link
}

function Find-ExistingCodexShortcut {
    $link = Join-Path $ShortcutDirectory 'Codex.lnk'
    if (-not [IO.File]::Exists($link)) { return }
    $shell = New-Object -ComObject WScript.Shell
    try {
        $item = $shell.CreateShortcut($link)
        if ($item.TargetPath -eq (Join-Path $InstallRoot 'CodexThemeLauncher.exe')) { return $link }
    } finally {
        if ($item) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) }
        $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
}

function Install-Desktop {
    $app = Find-DesktopPackage
    $appFile = Join-Path $app.InstallLocation 'app\ChatGPT.exe'
    $node = Join-Path $app.InstallLocation 'app\resources\cua_node\bin\node.exe'
    foreach ($file in $appFile,$node) {
        if (-not [IO.File]::Exists($file)) { throw "The official app layout differs: $file" }
    }
    $from = Join-Path $PSScriptRoot 'desktop'
    $dest = Join-Path $InstallRoot 'window-theme-character'
    $null = [IO.Directory]::CreateDirectory($dest)
    $identityDll = Join-Path $from 'WindowIdentity.dll'
    if (-not [IO.File]::Exists($identityDll)) { throw 'Use the packaged Windows ZIP, which includes WindowIdentity.dll.' }
    Install-Assets (Join-Path $dest 'skin')
    foreach ($file in 'WindowIdentity.dll','connect.mjs','theme.css','theme.js','verify.mjs','verify-settings.mjs','Show-CodexAmber.ps1') {
        Copy-VerifiedFile (Join-Path $from $file) (Join-Path $dest $file)
    }
    Copy-VerifiedFile (Join-Path $PSScriptRoot 'vscode\glass.css') (Join-Path $dest 'glass.css')
    $launch = Join-Path $dest 'Show-CodexAmber.ps1'
    $shortcut = Find-ExistingCodexShortcut
    if (-not $shortcut) { $shortcut = Set-Shortcut 'Codex Motion' $launch $appFile }
    "Desktop shortcut: $shortcut"
    "Codex desktop: $($app.Version)"
}

function Install-VSCode {
    $folder = Find-VSCodeExtension
    $metadata = Get-Content -LiteralPath (Join-Path $folder 'package.json') -Raw | ConvertFrom-Json
    if ($metadata.publisher -ne 'openai' -or $metadata.name -ne 'chatgpt' -or $metadata.version -ne $extensionVersion) {
        throw "This release supports openai.chatgpt $extensionVersion."
    }
    $webview = Join-Path $folder 'webview'
    $index = Join-Path $webview 'index.html'
    $backup = Join-Path $webview 'index.before-celeste-motion.html'
    $marker = '<!-- codex-amber-motion -->'
    $current = [IO.File]::ReadAllText($index)
    $patched = $current.Contains($marker)
    if ($Uninstall -and -not $patched) {
        'VS Code is already using the original webview.'
        return
    }
    $clean = $current
    if ($patched) {
        # Strip the exact theme blocks from the current template so an extension
        # update or other HTML outside the theme remains intact.
        $links = '(?m)^ {2,4}<!-- codex-amber-motion -->\r?\n    <link rel="stylesheet" href="\./codex-amber-character/motion\.css\?v=\d+">\r?\n(?:    <link rel="stylesheet" href="\./codex-amber-character/glass\.css\?v=\d+">\r?\n)?    <script defer src="\./codex-amber-character/motion\.js(?:\?v=\d+)?"></script>\r?\n'
        $layers = '(?m)^    <div id="codex-amber-background" aria-hidden="true">\r?\n      <video muted loop playsinline preload="none" data-source="\./codex-amber-character/background\.mp4\?v=\d+"></video>\r?\n    </div>\r?\n    <div id="codex-amber-intro" aria-hidden="true">\r?\n      <video muted playsinline preload="none" data-source="\./codex-amber-character/intro\.mp4\?v=\d+"></video>\r?\n    </div>\r?\n'
        if ([Regex]::Matches($current,$links).Count -ne 1 -or [Regex]::Matches($current,$layers).Count -ne 1) {
            throw 'The installed webview has a different theme structure. Restore the official extension template before continuing.'
        }
        $clean = [Regex]::Replace([Regex]::Replace($current,$links,''),$layers,'')
    }
    foreach ($token in '<!-- PROD_BASE_TAG_HERE -->','<!-- PROD_CSP_TAG_HERE -->','</head>','    <div id="root">') {
        if ([Regex]::Matches($clean, [Regex]::Escape($token)).Count -ne 1) {
            throw 'The official Codex webview template has changed. No files were replaced.'
        }
    }
    if ($Uninstall) {
        if ([IO.File]::ReadAllText($index) -cne $current) { throw 'The VS Code template changed during restoration.' }
        if ([IO.File]::Exists($backup) -and [IO.File]::ReadAllText($backup) -ceq $clean) {
            Copy-VerifiedFile $backup $index
        } else {
            Write-AtomicText $index $clean
        }
        'Restored the original VS Code webview. Reload the VS Code window.'
        return
    }
    if (-not [IO.File]::Exists($backup)) {
        if ($patched) { Write-AtomicText $backup $clean } else { Copy-VerifiedFile $index $backup }
    }
    $assetFolder = 'codex-amber-character'
    $assets = Join-Path $webview $assetFolder
    Install-Assets $assets
    foreach ($name in 'motion.css','glass.css','motion.js') {
        Copy-VerifiedFile (Join-Path $PSScriptRoot "vscode\$name") (Join-Path $assets $name)
    }
    $head = @"
  $marker
    <link rel="stylesheet" href="./$assetFolder/motion.css?v=$version">
    <link rel="stylesheet" href="./$assetFolder/glass.css?v=$version">
    <script defer src="./$assetFolder/motion.js?v=$version"></script>
  </head>
"@
    $layers = @"
    <div id="codex-amber-background" aria-hidden="true">
      <video muted loop playsinline preload="none" data-source="./$assetFolder/background.mp4?v=$version"></video>
    </div>
    <div id="codex-amber-intro" aria-hidden="true">
      <video muted playsinline preload="none" data-source="./$assetFolder/intro.mp4?v=$version"></video>
    </div>
    <div id="root">
"@
    $next = $clean.Replace('  </head>', $head).Replace('    <div id="root">', $layers)
    if ($next -eq $clean -or -not $next.Contains($marker)) { throw 'The VS Code template could not be updated.' }
    if ([IO.File]::ReadAllText($index) -cne $current) { throw 'The VS Code template changed during the deployment.' }
    Write-AtomicText $index $next
    'VS Code theme installed. Open or reload VS Code and open the Codex panel.'
}

function Install-Native {
    . (Join-Path $PSScriptRoot 'native\Targets.ps1')
    $exe = Find-MotionApplication $Target $Application
    $source = Join-Path $PSScriptRoot 'native'
    $dest = Join-Path $InstallRoot 'native'
    $null = [IO.Directory]::CreateDirectory($dest)
    Install-Assets (Join-Path $InstallRoot 'skin')
    foreach ($file in 'Launch.ps1','Targets.ps1','attach.mjs','scene.js') {
        Copy-VerifiedFile (Join-Path $source $file) (Join-Path $dest $file)
    }
    Copy-VerifiedFile (Join-Path $PSScriptRoot 'desktop\WindowIdentity.dll') (Join-Path $dest 'WindowIdentity.dll')
    $runtime = Join-Path $PSScriptRoot 'runtime'
    if ([IO.File]::Exists((Join-Path $runtime 'node.exe'))) {
        $localRuntime = Join-Path $InstallRoot 'runtime'
        $null = [IO.Directory]::CreateDirectory($localRuntime)
        foreach ($name in 'node.exe','LICENSE') {
            Copy-VerifiedFile (Join-Path $runtime $name) (Join-Path $localRuntime $name)
        }
    }
    $config = Join-Path $dest ($Target + '.json')
    Write-AtomicText $config (@{ application = $exe } | ConvertTo-Json -Compress)
    $shortcut = Set-Shortcut ($Target + ' Motion') (Join-Path $dest 'Launch.ps1') $exe ('-Target ' + $Target)
    "Desktop shortcut: $shortcut"
}

if ($Uninstall -and $Target -ne 'VSCode') { throw 'Uninstall is only used to restore the VS Code webview.' }
if (-not $Uninstall) { Test-Assets }
switch ($Target) {
    Desktop { Install-Desktop }
    VSCode { Install-VSCode }
    default { Install-Native }
}
