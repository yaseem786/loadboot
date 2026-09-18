# LoadBoot - one-shot installer for the nightly backup workflow.
# Run it once from PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\Users\HP\Documents\GitHub\loadboot\scripts\backup\install-backup.ps1
$ErrorActionPreference = "Stop"
$repo = "C:\Users\HP\Documents\GitHub\loadboot"
$src  = Join-Path $repo "scripts\backup\backup-workflow.yml"
$dstDir = Join-Path $repo ".github\workflows"
$dst  = Join-Path $dstDir "backup.yml"

if (-not (Test-Path $src)) { throw "Not found: $src" }

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item $src $dst -Force
Write-Host "placed  -> $dst" -ForegroundColor Green

Set-Location $repo
git add .github/workflows/backup.yml scripts/backup docs/BACKUP-RESTORE.md
git commit -m "Add nightly prod backup to Cloudflare R2"
git push
Write-Host ""
Write-Host "Pushed. Now open GitHub -> Actions -> 'Nightly backup (prod DB + Storage)' -> Run workflow." -ForegroundColor Cyan
