$ErrorActionPreference = "Stop"

$PSScriptRootParent = Split-Path -Parent $PSScriptRoot
$RepoAppRoot = Split-Path -Parent $PSScriptRootParent

$DesktopLive2D = Join-Path $RepoAppRoot "desktop\src-tauri\target\debug\data\live2D"
$AltDesktopLive2D = Join-Path $RepoAppRoot "desktop\src-tauri\data\live2D"
$Target = Join-Path $PSScriptRootParent "public\live2d"

if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }

$Source = $null
if (Test-Path $DesktopLive2D) { $Source = $DesktopLive2D }
elseif (Test-Path $AltDesktopLive2D) { $Source = $AltDesktopLive2D }

if (-not $Source) {
	Write-Host "[sync-models] 未找到桌面端模型目录" -ForegroundColor Yellow
	Write-Host "  搜索过: $DesktopLive2D"
	Write-Host "  搜索过: $AltDesktopLive2D"
	Write-Host "请把模型目录(如 arg-nori / nori)直接复制到 $Target"
	exit 1
}

Write-Host "[sync-models] 从 $Source 同步到 $Target"
Get-ChildItem -Path $Source -Directory | ForEach-Object {
	$dest = Join-Path $Target $_.Name
	if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
	Copy-Item -Recurse -Force $_.FullName $dest
	Write-Host "  + $($_.Name)"
}
Write-Host "[sync-models] done"
