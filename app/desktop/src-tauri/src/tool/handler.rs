//! ToolHandler trait + 运行时注册表
//!
//! 每个内置工具自己声明 `name()`, 启动时统一注册进 [`RuntimeRegistry`];
//! 后续插件系统需要时, 可升级为 inventory 自动注册.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::Connection;
use serde_json::Value;

use crate::tool::internal;

/// 内置工具 Handler: 接收参数, 返回 JSON 结果
pub trait ToolHandler: Send + Sync {
	/// Handler 身份 (与 ToolDefinition.executor 对应)
	fn name(&self) -> &str;
	/// 执行一次工具调用
	fn execute(&self, conn: &Connection, args: Value) -> Result<Value, String>;
}

/// 运行时注册表: 当前进程实际能执行什么
pub struct RuntimeRegistry {
	handlers: HashMap<String, Arc<dyn ToolHandler>>,
}

impl RuntimeRegistry {
	/// 注册全部内置 Handler (显式注册; 后续可换 inventory 自动收集)
	pub fn new() -> Self {
		let mut handlers: HashMap<String, Arc<dyn ToolHandler>> = HashMap::new();
		for handler in internal::builtin_handlers() {
			handlers.insert(handler.name().to_string(), handler);
		}
		Self { handlers }
	}

	/// 按 executor 名执行
	pub fn execute(&self, conn: &Connection, executor: &str, args: Value) -> Result<Value, String> {
		let handler = self
			.handlers
			.get(executor)
			.ok_or_else(|| format!("内部工具未找到: {executor}"))?;
		handler.execute(conn, args)
	}
}

impl Default for RuntimeRegistry {
	fn default() -> Self {
		Self::new()
	}
}
