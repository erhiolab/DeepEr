//! 内置工具实现
//!
//! 新增内置工具: 新建结构体 + 实现 [`ToolHandler`] + 加进 [`builtin_handlers`],
//! 并在 [`crate::tool::repository`] 的内置种子表里登记定义.

use std::sync::Arc;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::tool::handler::ToolHandler;
use crate::tool::repository;

/// 工具-搜索工具: 按关键词搜索已注册工具
pub struct ToolSearchHandler;

impl ToolHandler for ToolSearchHandler {
	fn name(&self) -> &str {
		"tool-search"
	}

	fn execute(&self, conn: &Connection, args: Value) -> Result<Value, String> {
		let query = args
			.get("query")
			.and_then(|v| v.as_str())
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.ok_or_else(|| "参数缺失: query(搜索关键词) 为必填参数".to_string())?;
		let limit = args
			.get("limit")
			.and_then(|v| v.as_u64())
			.unwrap_or(10)
			.clamp(1, 200) as usize;
		let tools = repository::search(conn, query, limit)?;
		Ok(json!({ "tools": tools }))
	}
}

/// 工具-获取全部工具: 返回全部已注册工具清单
pub struct ToolListAllHandler;

impl ToolHandler for ToolListAllHandler {
	fn name(&self) -> &str {
		"tool-list-all"
	}

	fn execute(&self, conn: &Connection, args: Value) -> Result<Value, String> {
		let limit = args
			.get("limit")
			.and_then(|v| v.as_u64())
			.unwrap_or(50)
			.clamp(1, 200) as usize;
		let all = repository::list(conn)?;
		let total = all.len();
		let tools: Vec<_> = all.into_iter().take(limit).collect();
		Ok(json!({ "total": total, "tools": tools }))
	}
}

/// 全部内置 Handler (显式注册)
pub fn builtin_handlers() -> Vec<Arc<dyn ToolHandler>> {
	vec![
		Arc::new(ToolSearchHandler),
		Arc::new(ToolListAllHandler),
	]
}
