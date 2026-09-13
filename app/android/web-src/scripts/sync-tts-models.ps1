# 同步端侧 TTS 模型到 Android 源集 (模型不入 git)
#
# 布局 (与 app/build.gradle 的 online/offline x std/full 口味对应):
#   online     : 共享模型 roberta(int8) + t2s_encoder(fp32) + vits(fp32) -> src/online/assets/tts
#   onlineStd  : t2s 解码器 int8 -> src/onlineStd/assets/tts
#   onlineFull : t2s 解码器 fp32 -> src/onlineFull/assets/tts
#   tts_data   : 音素表/词表/参考特征 -> src/online/assets/tts_data (由 build_tts_assets.py 生成)
# offline 口味不含端侧 TTS, 不需要这些资源.

param(
    [string]$Src = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
)

$ErrorActionPreference = "Stop"

# 仓库内 Android 资源根 (按脚本位置解析, 不写死盘符)
$assetsRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../app/src")).Path
$sharedDst = Join-Path $assetsRoot "online/assets/tts"
$stdDst    = Join-Path $assetsRoot "onlineStd/assets/tts"
$fullDst   = Join-Path $assetsRoot "onlineFull/assets/tts"
$dataDst   = Join-Path $assetsRoot "online/assets/tts_data"

foreach ($dir in @($sharedDst, $stdDst, $fullDst, $dataDst)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# 共享模型 (两口味相同)
$sharedFiles = @(
    "nori_roberta_int8.onnx",
    "nori_t2s_encoder_fp32.onnx",
    "nori_vits_fp32.onnx"
)
# std (量化) / full (全量) 只在 t2s 解码器上分档
$stdPackFiles  = @("mix6/nori_t2s_fsdec_int8.onnx", "mix6/nori_t2s_sdec_int8.onnx")
$fullPackFiles = @("nori_t2s_fsdec_fp32.onnx", "nori_t2s_sdec_fp32.onnx")

function Copy-Model([string]$relative, [string]$destination) {
    $from = Join-Path $Src $relative
    if (-not (Test-Path $from)) {
        Write-Warning "缺少源文件: $from"
        return
    }
    Copy-Item $from (Join-Path $destination (Split-Path $relative -Leaf)) -Force
}

foreach ($file in $sharedFiles)  { Copy-Model $file $sharedDst }
foreach ($file in $stdPackFiles) { Copy-Model $file $stdDst }
foreach ($file in $fullPackFiles) { Copy-Model $file $fullDst }

$dataSrc = Join-Path $Src "tts_data"
if (Test-Path $dataSrc) {
    Copy-Item (Join-Path $dataSrc "*") $dataDst -Recurse -Force
} else {
    Write-Warning "未找到 $dataSrc; tts_data 需先用 build_tts_assets.py 生成"
}

Write-Host ""
Write-Host "synced tts assets:"
foreach ($pair in @(
    @{ Label = "online 共享";   Dir = $sharedDst },
    @{ Label = "onlineStd";    Dir = $stdDst },
    @{ Label = "onlineFull";   Dir = $fullDst },
    @{ Label = "tts_data";     Dir = $dataDst }
)) {
    $stat = Get-ChildItem $pair.Dir -Recurse | Where-Object { -not $_.PSIsContainer } |
        Measure-Object -Property Length -Sum
    "{0,-12} {1,3} 个文件 {2,9:N1} MB" -f $pair.Label, $stat.Count, ($stat.Sum / 1MB)
}
