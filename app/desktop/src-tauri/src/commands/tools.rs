//! 工具注册机命令模块 (Definition Registry 只读接口)
//!
//! `tools` 表存放工具定义 (name / label / description / provider / executor / input_schema / config / enabled / version),
//! 由 [`crate::tool::repository`] 负责内置种子与查询. 执行统一走 `commands::tool::tool_execute`.

use crate::db;
use crate::tool::model::ToolDefinition;
use crate::tool::repository;

/// 搜索参数
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSearchArgs {
	/// 搜索关键词 (匹配调用名 / 中文标题 / 描述)
	pub query: String,
	/// 返回条数上限 (默认 10, 上限 200)
	#[serde(default)]
	pub limit: Option<u32>,
}

/// 获取全部工具 (按调用名排序)
/// invoke("tool_list")
#[tauri::command]
pub fn tool_list(state: tauri::State<'_, db::Db>) -> Result<Vec<ToolDefinition>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::list(&conn)
}

/// 搜索工具 (调用名 / 中文标题 / 描述模糊匹配; 空关键词返回全部)
/// invoke("tool_search", { args: { query: "记忆", limit: 10 } })
#[tauri::command]
pub fn tool_search(
	state: tauri::State<'_, db::Db>,
	args: ToolSearchArgs,
) -> Result<Vec<ToolDefinition>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::search(&conn, &args.query, args.limit.unwrap_or(10) as usize)
}
