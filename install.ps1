# Copilot Extension — package and (re)install the panel extension.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# The prompt files ship inside the extension and are installed into the user
# prompts folder by the extension itself on activation — this script only builds
# and installs the extension.

$ErrorActionPreference = 'Stop'

function Install-Extension {
    $extDir = Join-Path $PSScriptRoot 'extension'
    $pkgPath = Join-Path $extDir 'package.json'
    if (-not (Test-Path $pkgPath)) { throw "Extension not found: $extDir" }

    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $id = "$($pkg.publisher).$($pkg.name)"
    $vsix = Join-Path $extDir 'copilot-extension.vsix'

    $code = Get-Command code -ErrorAction SilentlyContinue
    if (-not $code) { throw "VS Code 'code' CLI not found on PATH." }

    Push-Location $extDir
    try {
        Write-Host "Packaging $id@$($pkg.version)..."
        & npx --yes @vscode/vsce package --allow-missing-repository --skip-license -o copilot-extension.vsix | Out-Null
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

Install-Extension

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reload VS Code: command palette -> 'Developer: Reload Window'."
Write-Host "     (This installs the bundled prompts and registers the panel.)"
Write-Host "  2. Open the 'Copilot Extension' panel and click '应用配置' to (re)apply the"
Write-Host "     Chat input-box buttons. The injected file path changes whenever the"
Write-Host "     extension version changes, so a refresh is needed after each update."
