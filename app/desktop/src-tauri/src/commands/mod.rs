//! Tauri 命令模块
//!
//! 前端通过 `invoke("<command>")` 调用这里的 #[tauri::command] 函数。
//! 按业务域拆分子模块, 保持与 lib.rs 中 `invoke_handler` 的注册同步:
//!
//! - [`first_run`] 首次运行
//! - [`log`] 日志写入
//! - [`language`] 系统语言
//! - [`llm`] LLM 模型
//! - [`live2d`] Live2D 线上列表
//! - [`resource`] 资源 (下载 / 检查 / 列表 / 删除 / 导入)

pub mod first_run;
pub mod language;
pub mod live2d;
pub mod llm;
pub mod log;
pub mod resource;
pub mod tts;
pub mod devtools;
