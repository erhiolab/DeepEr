//! 工具运行时模块
//!
//! 分层 (与前端约定一致):
//! - [`model`]     : ToolDefinition (DB 定义, 含 provider / executor / input_schema / config)
//! - [`repository`]: tools 表内置种子 / 查询 (Definition Registry)
//! - [`handler`]   : ToolHandler trait + RuntimeRegistry (当前进程实际能执行什么)
//! - [`internal`]  : 内置工具实现 (tool-search / tool-list-all)
//! - [`service`]   : ToolService 统一调度 (查定义 → 启用校验 → Schema 校验 → Provider 分派)

pub mod handler;
pub mod internal;
pub mod model;
pub mod repository;
pub mod service;
