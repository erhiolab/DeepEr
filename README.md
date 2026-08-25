<div align="center">

# 🎀 DeepEr

**一只会陪你上班 / 学习 / 摸鱼的桌面伙伴 · 澄渊**

基于 **Tauri 2 + Vue 3** 的现代桌面宠物应用, 支持 Live2D 模型、LLM 对话、TTS 语音与自动更新。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-teal)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3.5-brightgreen)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-orange)](https://rust-lang.org)
[![Platforms](https://img.shields.io/badge/Windows-x64-blue)](#下载安装)

</div>

---

## ✨ 功能特性

### 桌面宠物
- **Live2D 模型** — 内置高性能渲染引擎, 支持自定义模型导入（本地目录 / zip 包）
- **触摸交互** — 多种触摸触发动作（磨蹭 / 狂点 / 抚摸）, 宠物会实时回应
- **窗口穿透 / 置顶 / 缩放** — 灵活控制桌面宠物形态, 随时可调整
- **托盘常驻** — 最小化到系统托盘, 透明窗口无缝融入桌面

### AI 对话
- **多平台 LLM** — 支持 OpenAI / Anthropic / Google Gemini 协议
- **流式对话** — 实时流式输出, 表情互动
- **上下文记忆** — 自动保持多轮对话上下文

### 语音合成 (TTS)
- **GPT-SoVITS** — 接入本地 GPT-SoVITS 语音服务
- **自定义音色** — 多音色参考音频管理, 支持情感参数

### 系统与质量
- **自动更新** — 基于 GitHub Releases 的 OTA 自动更新, 安全签名验证
- **国际化** — 完整的中文界面（i18n 架构, 便于扩展多语言）
- **本地加密存储** — API Key 经 AES-256-GCM 加密后落库, 明文不往返前端

---

## 🛠️ 技术架构

```
DeepEr monorepo
├── app/desktop         桌面端（前端 Vue3 + 桌面后端 Rust/Tauri）
│   ├── src/            前端 Vue 应用（Vite / Pinia / vue-router / vue-i18n）
│   └── src-tauri/      Rust 桌面后端（Tauri commands + SQLite + 资源管理）
├── backend/            Go REST API 服务器（资源签名下载 / 请求日志 / CORS）
└── docs/               架构 / 规范 / 权限 / 发布文档
```

| 模块 | 技术 | 职责 |
| ---- | ---- | ---- |
| **桌宠主程序** | Rust + Tauri 2 | 窗口调度 / 命令系统 / SQLite 内存库 / 日志 |
| **前端 UI** | TypeScript + Vue 3 | 宠物界面 / 聊天 / 设置 / Live2D 渲染 / i18n |
| **Live2D 渲染** | TypeScript + Cubism SDK 5 | 本地模型加载（`asset://` 协议） |
| **AI 适配器** | Rust 后端 + TS 前端 | OpenAI / Anthropic / Gemini 协议实现 |
| **TTS 适配器** | Rust 后端 + TS 前端 | GPT-SoVITS 语音合成 |
| **后端网关** | Go | OSS 签名 URL / 上游转发 / 日志 / CORS（端口 8084） |
| **本地存储** | Rust + SQLite | 配置与首次初始化标记（key-value） |
| **自动更新** | tauri-plugin-updater | GitHub Releases 签名自动更新 |

---

## 📦 下载安装

从 [GitHub Releases](https://github.com/erhiolab/DeepEr/releases) 下载最新版安装包（Windows x64）。

安装后第一次启动会进入**初始化引导**（首次运行向导）, 依次完成: 协议确认 → 连接 LLM → 欢迎页。

> 后续版本更新会自动通过应用内"关于 → 检查更新"完成, 无需手动下载。

---

## 🔧 开发环境

### 前置依赖
- [Rust](https://www.rust-lang.org/) 1.77+
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9+
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（C++ 工具链）

### 启动开发

```bash
# 安装前端依赖
cd app/desktop
pnpm install

# 启动开发模式（自动唤起 Tauri 窗口）
pnpm tauri:dev
```

### 构建发布包

```bash
cd app/desktop
pnpm build          # 前端编译
pnpm tauri:build    # 构建桌面安装包
```

---

## 🤝 致谢

- **洱海 (erhiolab)** — 开发 · 维护
- **亓才孑 (QiCaiJie114514)** — 开发 · 维护
- **I_NORI 交流群** — 反馈 · 建议

有问题或建议欢迎提 [Issue](https://github.com/erhiolab/DeepEr/issues)。

---

## 📄 协议

本项目源代码采用 [GPL-3.0](LICENSE) 授权。

**注意**: 项目使用的 **Live2D Cubism SDK** 不属于 GPL-3.0 授权范围。Live2D Cubism SDK 及其相关组件 / 运行库等受 Live2D Inc. 独立许可协议约束。使用 / 复制 / 修改 / 分发 Live2D SDK 时, 应遵守 Live2D 官方许可协议。

GPL-3.0 仅适用于本项目中由项目作者提供并明确标记为 GPL-3.0 的部分, 不授予对 Live2D SDK 或其他第三方组件的任何额外权利。
