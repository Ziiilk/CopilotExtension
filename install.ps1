# Install prompt files to the VS Code user prompts folder.
# Usage: powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'prompts'
$dst = Join-Path $env:APPDATA 'Code\User\prompts'

if (-not (Test-Path $src)) {
    throw "Source folder not found: $src"
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null

Get-ChildItem -Path $src -File | ForEach-Object {
    Copy-Item $_.FullName -Destination $dst -Force
    Write-Host "Installed: $($_.Name)"
}

Write-Host ""
Write-Host "Done. Reload VS Code (Developer: Reload Window) to pick up changes." -ForegroundColor Green
Write-Host "Target: $dst"
