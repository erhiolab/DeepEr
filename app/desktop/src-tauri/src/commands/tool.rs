//! 工具执行命令
//!
//! 前端 (Agent 循环) 只负责解析 <tool_call> 与回填结果, 真正的执行在 Rust 侧:
//! `ToolService.execute` → Definition Registry 查定义 → Schema 校验 → Provider 分派 → RuntimeRegistry.

use serde_json::Value;

use crate::db;
use crate::tool::service::ToolService;

/// 执行一次工具调用
/// invoke("tool_execute", { toolName: "tool-search", args: { query: "记忆", limit: 10 } })
#[tauri::command]
pub fn tool_execute(
	state: tauri::State<'_, db::Db>,
	tool_name: String,
	args: Value,
) -> Result<Value, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	ToolService::global().execute(&conn, &tool_name, args)
}
