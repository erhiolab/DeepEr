//! MCP 服务器命令模块

use serde_json::json;

use crate::db;
use crate::mcp::model::{McpServerInput, McpServerRecord};
use crate::mcp::repository;

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 归一化并校验输入
fn normalize(input: &McpServerInput) -> Result<McpServerInput, String> {
	let name = input.name.trim();
	if name.is_empty() {
		return Err("MCP 名称不能为空".to_string());
	}
	let transport = input.transport.trim();
	if transport != "stdio" && transport != "sse" {
		return Err("传输方式无效: 可选 stdio / sse".to_string());
	}
	if transport == "stdio" && input.command.trim().is_empty() {
		return Err("stdio 传输需要填写启动命令".to_string());
	}
	if transport == "sse" && input.url.trim().is_empty() {
		return Err("sse 传输需要填写服务器地址".to_string());
	}
	Ok(McpServerInput {
		name: name.to_string(),
		description: input.description.trim().to_string(),
		transport: transport.to_string(),
		command: input.command.trim().to_string(),
		args: if input.args.is_array() { input.args.clone() } else { json!([]) },
		url: input.url.trim().to_string(),
		headers: if input.headers.is_object() { input.headers.clone() } else { json!({}) },
		env: if input.env.is_object() { input.env.clone() } else { json!({}) },
	})
}

/// 全部 MCP 服务器
/// invoke("mcp_list")
#[tauri::command]
pub fn mcp_list(state: tauri::State<'_, db::Db>) -> Result<Vec<McpServerRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::list(&conn)
}

/// 添加 MCP 服务器
/// invoke("mcp_create", { args: { name, description, transport, command, args, url, headers, env } })
#[tauri::command]
pub fn mcp_create(
	state: tauri::State<'_, db::Db>,
	args: McpServerInput,
) -> Result<McpServerRecord, String> {
	let input = normalize(&args)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let id = repository::create(&conn, &input, now())?;
	repository::get(&conn, id)?.ok_or_else(|| "MCP 服务器创建失败".to_string())
}

/// 配置 MCP 服务器
/// invoke("mcp_update", { id, args: { ... } })
#[tauri::command]
pub fn mcp_update(
	state: tauri::State<'_, db::Db>,
	id: i64,
	args: McpServerInput,
) -> Result<McpServerRecord, String> {
	let input = normalize(&args)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::update(&conn, id, &input, now())?;
	repository::get(&conn, id)?.ok_or_else(|| "MCP 服务器不存在".to_string())
}

/// 删除 MCP 服务器
/// invoke("mcp_delete", { id })
#[tauri::command]
pub fn mcp_delete(state: tauri::State<'_, db::Db>, id: i64) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::delete(&conn, id)
}

/// 切换 MCP 服务器启用状态
/// invoke("mcp_set_enabled", { id, enabled })
#[tauri::command]
pub fn mcp_set_enabled(
	state: tauri::State<'_, db::Db>,
	id: i64,
	enabled: bool,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::set_enabled(&conn, id, enabled, now())
}
