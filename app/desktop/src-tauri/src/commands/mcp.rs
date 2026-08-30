//! MCP 服务器命令模块

use serde_json::json;
use tauri::AppHandle;

use crate::db;
use crate::log::{self, LogSource};
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
	if transport != "stdio" && transport != "sse" && transport != "http" {
		return Err("传输方式无效: 可选 stdio / sse / http".to_string());
	}
	if transport == "stdio" && input.command.trim().is_empty() {
		return Err("stdio 传输需要填写启动命令".to_string());
	}
	if (transport == "sse" || transport == "http") && input.url.trim().is_empty() {
		return Err("sse/http 传输需要填写服务器地址".to_string());
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

/// 后台同步单个服务器工具 (失败仅记日志, 不阻塞写操作)
fn schedule_sync(app: &AppHandle, id: i64) {
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		if let Err(error) = crate::mcp::runtime::sync_server_by_id(&app, id).await {
			let _ = log::write(
				&app,
				&LogSource::Backend,
				"error",
				&format!("同步 MCP 工具失败: {error}"),
			);
		}
	});
}

/// 后台清理工具并断开连接 (禁用/删除)
fn schedule_disable(app: &AppHandle, id: i64) {
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		crate::mcp::runtime::disable_server(&app, id).await;
	});
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

/// 添加 MCP 服务器 (创建后自动同步工具)
/// invoke("mcp_create", { args: { name, description, transport, command, args, url, headers, env } })
#[tauri::command]
pub fn mcp_create(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	args: McpServerInput,
) -> Result<McpServerRecord, String> {
	let input = normalize(&args)?;
	let server = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		let id = repository::create(&conn, &input, now())?;
		repository::get(&conn, id)?.ok_or_else(|| "MCP 服务器创建失败".to_string())?
	};
	if server.enabled {
		schedule_sync(&app, server.id);
	}
	Ok(server)
}

/// 配置 MCP 服务器 (更新后自动重新同步)
/// invoke("mcp_update", { id, args: { ... } })
#[tauri::command]
pub fn mcp_update(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	id: i64,
	args: McpServerInput,
) -> Result<McpServerRecord, String> {
	let input = normalize(&args)?;
	let server = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		repository::update(&conn, id, &input, now())?;
		repository::get(&conn, id)?.ok_or_else(|| "MCP 服务器不存在".to_string())?
	};
	if server.enabled {
		schedule_sync(&app, id);
	} else {
		schedule_disable(&app, id);
	}
	Ok(server)
}

/// 删除 MCP 服务器 (清理其同步工具并断开连接)
/// invoke("mcp_delete", { id })
#[tauri::command]
pub fn mcp_delete(app: AppHandle, state: tauri::State<'_, db::Db>, id: i64) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::delete(&conn, id)?;
	drop(conn);
	schedule_disable(&app, id);
	Ok(())
}

/// 切换启用状态 (启用后同步工具, 禁用后清理)
/// invoke("mcp_set_enabled", { id, enabled })
#[tauri::command]
pub fn mcp_set_enabled(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	id: i64,
	enabled: bool,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::set_enabled(&conn, id, enabled, now())?;
	drop(conn);
	if enabled {
		schedule_sync(&app, id);
	} else {
		schedule_disable(&app, id);
	}
	Ok(())
}

/// 手动同步全部已启用服务器 (返回每台服务器结果)
/// invoke("mcp_sync")
#[tauri::command]
pub async fn mcp_sync(app: AppHandle) -> Result<Vec<crate::mcp::runtime::SyncSummary>, String> {
	Ok(crate::mcp::runtime::sync_all(&app).await)
}
