$ErrorActionPreference = "Stop"
$src = "F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori"
$dst = "F:/Nori-Desktop-Pet/app/android/app/src/main/assets"

New-Item -ItemType Directory -Force -Path "$dst/tts"    | Out-Null
New-Item -ItemType Directory -Force -Path "$dst/tts_data" | Out-Null

# 6G 档(mix6): 编解码器(fsdec/sdec)用 int8, 其余 fp32
Copy-Item "$src/nori_roberta_int8.onnx"           "$dst/tts/" -Force
Copy-Item "$src/nori_t2s_encoder_fp32.onnx"       "$dst/tts/" -Force
Copy-Item "$src/mix6/nori_t2s_fsdec_int8.onnx"    "$dst/tts/" -Force
Copy-Item "$src/mix6/nori_t2s_sdec_int8.onnx"     "$dst/tts/" -Force
Copy-Item "$src/nori_vits_fp32.onnx"              "$dst/tts/" -Force

Write-Host "synced tts models:"
Get-ChildItem "$dst/tts" | ForEach-Object { "{0,8:N1} MB  {1}" -f ($_.Length / 1MB), $_.Name }
