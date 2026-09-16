# Build script for packaging the Python FastAPI backend as a sidecar executable.
# Supports both x86_64-pc-windows-gnu and x86_64-pc-windows-msvc targets.
#
# Usage:
#   ./build-backend.ps1                    # Builds for gnu target (default)
#   ./build-backend.ps1 -Target msvc       # Builds for msvc target

param(
    [ValidateSet("gnu", "msvc")]
    [string]$Target = "gnu"
)

$ErrorActionPreference = "Stop"

$TARGET_TRIPLE = if ($Target -eq "msvc") {
    "x86_64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-gnu"
}

Write-Host "=== Building Python Backend Sidecar for $TARGET_TRIPLE ===" -ForegroundColor Cyan

$REPO_ROOT = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$API_DIR = Join-Path $REPO_ROOT "apps/api"
$DEST_DIR = Join-Path $REPO_ROOT "apps/desktop/src-tauri/bin"

# Install dependencies
Write-Host "[1/4] Installing Python dependencies..." -ForegroundColor Yellow
Push-Location -LiteralPath $API_DIR
try {
    & ./venv/Scripts/python -m pip install -r requirements.txt --quiet
    & ./venv/Scripts/python -m pip install pyinstaller --quiet

    # Build with PyInstaller
    Write-Host "[2/4] Running PyInstaller..." -ForegroundColor Yellow
    $SPEC_FILE = "specs/api-$TARGET_TRIPLE.spec"

    if (Test-Path $SPEC_FILE) {
        Write-Host "Using existing spec file: $SPEC_FILE"
        & ./venv/Scripts/python -m PyInstaller $SPEC_FILE --noconfirm
    } else {
        Write-Host "No spec file found, building with default options..."
        & ./venv/Scripts/python -m PyInstaller --onefile --noconsole --name "api-$TARGET_TRIPLE" app.py --noconfirm
    }

    # Create destination directory and copy the executable.
    Write-Host "[3/4] Copying binary..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $DEST_DIR -Force | Out-Null
    Copy-Item "dist/api-$TARGET_TRIPLE.exe" (Join-Path $DEST_DIR "api-$TARGET_TRIPLE.exe") -Force
}
finally {
    Pop-Location
}

Write-Host "[4/4] Done!" -ForegroundColor Green
$OUTPUT_PATH = Join-Path $DEST_DIR "api-$TARGET_TRIPLE.exe"
Write-Host "Output: $OUTPUT_PATH" -ForegroundColor Green
