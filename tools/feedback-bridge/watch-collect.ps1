# Tencent Docs form collector watcher (periodic poll, mirror of watch.ps1 pattern)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
$log = Join-Path $root 'tools\feedback-bridge\collect.log'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '[ERROR] Node.js not found'; exit 1 }
Write-Host "Collector watcher started. Log: $log  -  Press Ctrl+C to stop."
while ($true) {
  try {
    node tools\feedback-bridge\collect-docs.mjs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  } catch {
    "`n[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] poll failed: $_" | Out-File -FilePath $log -Append -Encoding utf8
  }
  Start-Sleep -Seconds 1800
}
