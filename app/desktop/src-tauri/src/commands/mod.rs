//! Tauri 命令模块
//!
//! 前端通过 `invoke("<command>")` 调用这里的 `#[tauri::command]` 函数. 
//! 按业务域拆分子模块, 保持与 lib.rs 中 `invoke_handler` 的注册同步. 
//!
//! - [`first_run`] 首次运行
//! - [`log`] 日志写入
//! - [`language`] 系统语言
//! - [`llm`] LLM 模型(适配器模式, 协议逻辑在后端)
//! - [`live2d`] Live2D 在线列表
//! - [`persona`] 人设 (角色卡) 管理
//! - [`tools`] 工具注册机 (工具清单 / 搜索)
//! - [`tool`] 工具执行 (ToolService 调度)
//! - [`agent`] Agent 循环 (LLM 多轮工具调用)
//! - [`resource`] 资源 (下载 / 检查 / 列表 / 删除 / 导入)
//! - [`tts`] 文本转语音(适配器模式, 协议逻辑在后端)
//! - [`devtools`] 开发者工具 (DevTools) 运行开关命令
//! - [`task_manager`] 浏览器任务管理器 (Browser Task Manager) 命令

pub mod agent;
pub mod context;
pub mod devtools;
pub mod first_run;
pub mod language;
pub mod live2d;
pub mod llm;
pub mod log;
pub mod persona;
pub mod resource;
pub mod task_manager;
pub mod tool;
pub mod tools;
pub mod tts;
