# Oh My Copilot — install / update prompts and the panel extension.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1            # prompts + extension
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Prompts   # prompts only
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Extension # extension only
#
# Re-running this script updates whatever is selected to the current repo state.

[CmdletBinding()]
param(
    [switch]$Prompts,
    [switch]$Extension
)

$ErrorActionPreference = 'Stop'

# No switch given => do both.
if (-not $Prompts -and -not $Extension) {
    $Prompts = $true
    $Extension = $true
}

function Install-Prompts {
    $src = Join-Path $PSScriptRoot 'prompts'
    $dst = Join-Path $env:APPDATA 'Code\User\prompts'
    if (-not (Test-Path $src)) { throw "Source folder not found: $src" }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Get-ChildItem -Path $src -File | ForEach-Object {
        Copy-Item $_.FullName -Destination $dst -Force
        Write-Host "  prompt: $($_.Name)"
    }
    Write-Host "Prompts installed to: $dst" -ForegroundColor Green
}

function Install-Extension {
    $extDir = Join-Path $PSScriptRoot 'extension'
    $pkgPath = Join-Path $extDir 'package.json'
    if (-not (Test-Path $pkgPath)) { throw "Extension not found: $extDir" }

    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $id = "$($pkg.publisher).$($pkg.name)"
    $vsix = Join-Path $extDir 'oh-my-copilot.vsix'

    $code = Get-Command code -ErrorAction SilentlyContinue
    if (-not $code) { throw "VS Code 'code' CLI not found on PATH." }

    Push-Location $extDir
    try {
        Write-Host "Packaging $id@$($pkg.version)..."
        & npx --yes @vscode/vsce package --allow-missing-repository --skip-license -o oh-my-copilot.vsix | Out-Null
        if (-not (Test-Path $vsix)) { throw "Packaging failed: $vsix not produced." }

        # Uninstall first so a same-version reinstall actually re-extracts files.
        # code.cmd writes harmless noise to stderr, which $ErrorActionPreference
        # 'Stop' would treat as fatal — run these under 'Continue'.
        $ErrorActionPreference = 'Continue'
        if ((& code --list-extensions) -contains $id) {
            & code --uninstall-extension $id 2>$null | Out-Null
            Start-Sleep -Milliseconds 600
        }
        & code --install-extension $vsix 2>$null | Out-Null
        $ErrorActionPreference = 'Stop'

        Write-Host "Extension installed: $id@$($pkg.version)" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

if ($Prompts) { Install-Prompts }
if ($Extension) { Install-Extension }

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reload VS Code: command palette -> 'Developer: Reload Window'."
if ($Extension) {
    Write-Host "  2. Open the 'Oh My Copilot' panel and click '应用配置' to (re)apply the"
    Write-Host "     Chat input-box buttons. The injected file path changes whenever the"
    Write-Host "     extension version changes, so a refresh is needed after each update."
}
