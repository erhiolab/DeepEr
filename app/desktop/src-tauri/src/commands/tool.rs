//! 工具执行命令
//!
//! 前端 (Agent 循环) 只负责解析 `<tool_call>` 与回填结果, 真正的执行在 Rust 侧:
//! `ToolService.execute` → Definition Registry 查定义 → Schema 校验 → Provider 分派 → RuntimeRegistry.
//! MCP 工具需要连接外部服务器, 走异步专用路径.

use serde_json::Value;
use tauri::AppHandle;

use crate::db;
use crate::mcp::runtime as mcp_runtime;
use crate::tool::service::ToolService;

/// 执行一次工具调用
/// invoke("tool_execute", { toolName: "tool-search", args: { query: "记忆", limit: 10 } })
#[tauri::command]
pub async fn tool_execute(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	tool_name: String,
	args: Value,
) -> Result<Value, String> {
	// MCP 工具: 查询定义走异步路径, 不占 DB 锁
	let provider = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		crate::tool::repository::get_by_name(&conn, &tool_name)
			.map(|definition| definition.map(|tool| tool.provider))
			.unwrap_or(None)
	};
	if mcp_runtime::is_mcp_provider(provider.as_deref().unwrap_or("")) {
		return mcp_runtime::execute_tool(&app, &tool_name, args).await;
	}
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	ToolService::global().execute(&conn, &tool_name, args)
}
