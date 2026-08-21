$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dashboardDist = Join-Path $root "apps/dashboard/dist"
$embedDist = Join-Path $root "daemon/internal/server/dashboard/dist"
$daemonDir = Join-Path $root "daemon"
$output = Join-Path $daemonDir "meowthd.exe"
$goCommand = Get-Command go.exe -ErrorAction SilentlyContinue
if ($null -ne $goCommand) {
    $goExe = $goCommand.Source
} else {
    $goExe = Join-Path $env:ProgramFiles "Go/bin/go.exe"
    if (-not (Test-Path -LiteralPath $goExe)) {
        throw "Go was not found on PATH or at '$goExe'. Install Go and restart the terminal."
    }
}

Push-Location $root
try {
    pnpm --filter @meowth/dashboard build
    if ($LASTEXITCODE -ne 0) { throw "dashboard build failed" }

    if (-not (Test-Path -LiteralPath (Join-Path $dashboardDist "index.html"))) {
        throw "dashboard build did not produce apps/dashboard/dist/index.html"
    }

    New-Item -ItemType Directory -Force -Path $embedDist | Out-Null
    Get-ChildItem -LiteralPath $embedDist -Force | Where-Object Name -ne ".gitkeep" | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $dashboardDist "*") -Destination $embedDist -Recurse -Force

    $version = (Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json).version
    Push-Location $daemonDir
    try {
        & $goExe build -ldflags "-X main.Version=$version" -o $output ./cmd/meowthd
        if ($LASTEXITCODE -ne 0) { throw "daemon build failed" }
    } finally {
        Pop-Location
    }
} finally {
    Pop-Location
}

Write-Host "Built $output"
