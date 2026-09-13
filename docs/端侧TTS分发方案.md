# 端侧 TTS 分发方案

> **最终方案(已实施)**: 端侧 TTS 走 **online 口味**(模型直接打包进 APK, 网关不下发模型, 不产生云存储费用), 分 **std(量化) / full(全量)** 两档质量; **offline 口味不打包 TTS**, 但把 Live2D 模型内置进 APK, 做到开箱即用。online 口味的 Live2D 仍走网关下载, 存公共目录 `Download/DeepEr/models`, **卸载应用不丢失**。

## 口味 x 档位 = 4 个 release 变体

| 变体 | Live2D | 端侧 TTS | 体积量级 | 用途 |
| --- | --- | --- | --- | --- |
| `onlineStd` | 网关下载 | 内置 (t2s 解码器 int8) | 约 660MB | 4G/6G 内存设备 |
| `onlineFull` | 网关下载 | 内置 (t2s 解码器 fp32) | 约 1090MB | 8G+ 内存设备 |
| `offlineStd` | 内置进 APK | 无 | 约 35MB | 开箱即用, 不联网下模型 |
| `offlineFull` | 内置进 APK | 无 | 约 35MB | 与 `offlineStd` 内容一致, 一般不需要出包 |

要点:

- **TTS 开关 = 选 online 还是 offline 口味**: `online` 的 `BuildConfig.ENABLE_TTS = true` 且前端 `__TTS_ENABLED__ = true`; `offline` 两者都为 false, 编译期就不含 `TtsEngine` / `TtsBridge`。
- **档位只影响 online**: `std` / `full` 的差别只在 t2s 解码器 int8 / fp32(151MB vs 587MB), 共享模型完全相同; offline 没有 TTS 模型可换, 所以 `offlineStd` 与 `offlineFull` 产物一致。
- **ABI**: `arm64-v8a` / `armeabi-v7a` / `x86_64`, 命名 `DeepEr-<版本>-<口味>-<abi>-release.apk`。

## 结论

- online APK 内置全部 TTS 模型, 首次启动解压到 `filesDir/tts` (带 versionCode 戳, 升级换模型时自动重新解压), 之后离线可用。
- offline APK 内置 Live2D 模型: `ModelBridge.isOffline()` 返回 true, 模型列表与文件读取全部走 APK 内资源(`assets/live2d/...`), 不请求网关也不申请存储权限。
- 模型资产不入 git(`.gitignore`), 用 `web-src/scripts/sync-tts-models.ps1` 从 `F:/TTSAI/GPT-SoVITS-v2pro-20250604/onnx/nori` 同步到对应源集。
- 资产设置 `noCompress: onnx`: 打包与首启解压都快(fp32 权重本身压缩率仅 ~10%)。
- Live2D(online): `ModelBridge` 根目录改为 `Environment.DIRECTORY_DOWNLOADS/DeepEr/models`; 首次调用自动把旧 `filesDir/models` 迁移过去; 权限链路 = ≤Android 10 运行时读写权限(legacy storage), ≥Android 11 引导「所有文件访问」(`MANAGE_EXTERNAL_STORAGE`, 侧载应用适用); 下载/列表接口在无权限时返回明确错误提示。
- **已下线**: 按内存自动选档下载、`tts.json` 清单、OSS 下载链路(TTS 部分)——不再需要。

## 模型资产布局

| 位置 | 文件 | 体积 |
| --- | --- | --- |
| `app/src/online/assets/tts/` (online 共享) | nori_roberta_int8(倒数第三层特征), nori_t2s_encoder_fp32, nori_vits_fp32 | 约 543MB |
| `app/src/online/assets/tts_data/` | symbols/pinyin/vocab/refs + 15 情绪预计算特征 | 约 13MB |
| `app/src/online/assets/ref/` | 15 条情绪参考音频 + refs.json (已入 git) | 约 4MB |
| `app/src/onlineStd/assets/tts/` | nori_t2s_fsdec_int8, nori_t2s_sdec_int8 | 约 151MB |
| `app/src/onlineFull/assets/tts/` | nori_t2s_fsdec_fp32, nori_t2s_sdec_fp32 | 约 587MB |
| `app/src/online/java/` | TtsBridge.kt / TtsEngine.kt (仅 online 口味编译) | - |
| `app/src/offline/assets/live2d/` | 内置 Live2D 模型(ARGNori / Nori) | 约 31MB |

量化决策: roberta int8 只量化 MatMul/Gemm(与 torch 倒数第三层对拍余弦 0.991); 参考音频 SSL 特征构建期预计算(hubert int8 的 Conv 算子在 CPU EP 不可用, 已绕开); 声码器 vits 恒 fp32; 两档差别只在 GPT 自回归半边 int8/fp32。

**端到端验证**: 纯 ONNX 链路(预计算参考特征 + roberta int8 + t2s + vits)合成成功, 音色相似度 0.848(单次抽样正常波动带内, torch 基线均值 0.844~0.871)。

## 构建

```bash
cd app/android

# 4 个 release 变体 (构建前会自动先编对应口味的 web 产物)
./gradlew :app:assembleOnlineStdRelease    # 量化 + 端侧 TTS + 在线 Live2D
./gradlew :app:assembleOnlineFullRelease   # 全量 + 端侧 TTS + 在线 Live2D
./gradlew :app:assembleOfflineStdRelease   # 内置 Live2D + 无 TTS
./gradlew :app:assembleOfflineFullRelease  # 与 offlineStd 内容一致, 一般不需要

# 只要 debug 包时把 Release 换成 Debug:
./gradlew :app:assembleOfflineStdDebug
```

- 前端(web)产物由 `app/build.gradle` 注册的 `buildOnlineWeb` / `buildOfflineWeb` 任务生成, 分别注入 `VITE_TTS_ENABLED=true/false` 与各自的 `WEB_OUT_DIR`, 输出到 `app/build/generated/web-assets/<口味>/web`, 再由对应口味的 assets 合并(flavor 覆盖 main)。
- Android 侧与前端两侧的 TTS 开关来自同一份口味定义: `BuildConfig.ENABLE_TTS`(是否注册 `NoriTTS` 桥) 与 `__TTS_ENABLED__`(是否渲染语音页)。
- 同步模型后再打包: `powershell -ExecutionPolicy Bypass -File web-src/scripts/sync-tts-models.ps1`

## 代码结构

- `TtsEngine`(完整端侧推理, online 口味): 首启解压 `tts`(模型)+`tts_data`(数据) → G2P(字符音素表 + 一/不变调) → roberta int8 文本 BERT(按字对齐 word2ph) → encoder/fsdec/sdec 自回归(EOS=1024, 上限 600 步) → vits 出 32kHz PCM → AudioTrack 播放; `enqueue/playBuffered/stopAll` 队列模型; 合成线程与播放线程分离, 支持打断。
- `TtsBridge`(`window.NoriTTS`, online 口味): `init()/ready()/synthesize(text,emotion)/play(id)/stop()`, 事件经 `window.__noriTTSRes` 回传(ready/done/error/init)。`MainActivity` 按 `BuildConfig.ENABLE_TTS` 反射挂载, offline 口味不含该类。
- 前端 `services/tts/index.ts` + `App.vue`: AI 回复按句拆分 → `await synthesize(句)` → **文字上屏与语音同时开始**(逐句同步); 触摸回应走 `surface()` 后同样配音; 用户发新消息自动 `stop()` 打断上一段; offline 口味下语音页与播报入口整体隐藏。
- 资产: `tts_data/` 由 `web-src/scripts/build_tts_assets.py` 生成 —— symbols.json(音素表)/pinyin.tsv(20897 字音素映射)/roberta_vocab.json/refs.json + 15 情绪的参考特征(refbert_*.bin, refssl_*.bin)。**hubert ONNX 已下线**(参考音频 SSL 特征全部构建期预计算, 绕开 int8 Conv 算子不兼容问题)。
- `ModelBridge`: online 时 `modelsDir` = `Download/DeepEr/models`(公共), `migrateLegacyModels()` 自动搬迁旧私有目录, 无权限时 `download()` 返回提示而非异常; offline 时 `isOffline()` = true, `listInstalled()` 直接列出内置模型, `download()` 命中内置资源即返回成功。
- `ChatBridge.storageReady(ctx)` 静态助手: 安卓11+ 判 `isExternalStorageManager()`, 低版本判运行时权限; `requestStoragePermission()` 按版本分支。

## 用户选择指引

1. **选口味**: 想开箱即用(不下载模型)选 `offline`, 但它没有语音合成; 想要语音就选 `online`。
2. **选档位**(仅 online): 4G/6G 内存手机建议 `std`(体积小、int8 推理更省内存); 8G+ 建议 `full`(全 fp32, 质量上限更高)。两档音色差异主要在韵律稳定性, 音色相似度本身差距很小(见下)。
3. **选 ABI**: 近年手机(2016+)选 `arm64-v8a`; 老 32 位设备选 `armeabi-v7a`; 模拟器选 `x86_64`。

## Android 版本兼容(21 → 16/17)

- minSdk **21**(Android 5.0): ONNX Runtime 1.20.0 的 AAR 声明 minSdk 21, 全依赖兼容。
- **前端 WebView 兼容(安卓 7/8 的关键)**: vite 设 `build.target: es2015` + `@vitejs/plugin-legacy@6`(targets: Chrome>=61/Android>=7), 产物带 SystemJS legacy 块与 nomodule 回退。安卓 5/6 未更新 WebView(Chromium < 49)缺 Proxy, Vue 3 无法运行, 需 Play 更新 WebView。
- targetSdk **34**: 在 Android 15/16/17 上以系统兼容模式运行; **16KB 页设备**: `.so` 压缩存储由安装器对齐, ORT 1.20.0 兼容。
- 构建链: Gradle 8.8(本地发行版) + AGP 8.6.1 + JDK 17。

## 质量校准工具(配套)

- `web-src/scripts/timbre_sim.py`: ERes2NetV2 声纹嵌入余弦相似度, 量化"像不像 Nori"。基线: 参考音频互相关 0.878, 训练素材对质心 0.911; 样本 0.87~0.90 即自然带。
- `web-src/scripts/tune_sweep.py`: GPU 批量生成样本(top_k 梯度 + 全情绪)到 `F:/TTSAI/tune/`。
- 结论(统计版): top_k=10 平均 0.871±0.024 vs top_k=20 平均 0.866±0.017——**拉条对音色精度无显著影响**; 真正提升靠补数据加训、优选参考音频、统一检查点、服务端多次采样取最优。

## 后续待办

- [ ] `TtsEngine` 接入 ONNX Runtime 推理(t2s_encoder/fsdec/sdec 自回归循环 + vits + 中文分词)。
- [ ] 首启解压进度透传到前端 UI(现在是日志回调)。
- [ ] `full` 档位在 4G 内存设备上的运行时内存实测(必要时引导这类用户选 std)。
- [ ] offline 口味若需要档位差异(如纹理压缩版 Live2D), 再补 `offlineStd` / `offlineFull` 的资源区分。
