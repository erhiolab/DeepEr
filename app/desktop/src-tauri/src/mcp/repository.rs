//! mcp_servers 表数据访问

use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

use crate::mcp::model::{McpServerInput, McpServerRecord};

const MCP_COLUMNS: &str =
	"id, name, description, transport, command, args, url, headers, env, enabled, created_at, updated_at";

fn parse_json(raw: Option<String>, fallback: Value) -> Value {
	raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(fallback)
}

fn row_to_server(row: &Row<'_>) -> rusqlite::Result<McpServerRecord> {
	Ok(McpServerRecord {
		id: row.get(0)?,
		name: row.get(1)?,
		description: row.get(2)?,
		transport: row.get(3)?,
		command: row.get(4)?,
		args: parse_json(row.get(5)?, json!([])),
		url: row.get(6)?,
		headers: parse_json(row.get(7)?, json!({})),
		env: parse_json(row.get(8)?, json!({})),
		enabled: row.get::<_, i64>(9)? != 0,
		created_at: row.get(10)?,
		updated_at: row.get(11)?,
	})
}

/// 全部 MCP 服务器 (按名称排序)
pub fn list(conn: &Connection) -> Result<Vec<McpServerRecord>, String> {
	let mut stmt = conn
		.prepare(&format!("SELECT {MCP_COLUMNS} FROM mcp_servers ORDER BY name ASC"))
		.map_err(|e| format!("查询 MCP 服务器失败: {e}"))?;
	let rows = stmt
		.query_map([], row_to_server)
		.map_err(|e| format!("查询 MCP 服务器失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析 MCP 服务器失败: {e}"))?;
	Ok(rows)
}

/// 按 id 查服务器
pub fn get(conn: &Connection, id: i64) -> Result<Option<McpServerRecord>, String> {
	let mut stmt = conn
		.prepare(&format!("SELECT {MCP_COLUMNS} FROM mcp_servers WHERE id = ?1"))
		.map_err(|e| format!("查询 MCP 服务器失败: {e}"))?;
	let mut rows = stmt
		.query_map(params![id], row_to_server)
		.map_err(|e| format!("查询 MCP 服务器失败: {e}"))?;
	match rows.next() {
		Some(Ok(server)) => Ok(Some(server)),
		Some(Err(e)) => Err(format!("解析 MCP 服务器失败: {e}")),
		None => Ok(None),
	}
}

/// 新建服务器, 返回新 id
pub fn create(conn: &Connection, input: &McpServerInput, now: i64) -> Result<i64, String> {
	conn.execute(
		"INSERT INTO mcp_servers (name, description, transport, command, args, url, headers, env, enabled, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)",
		params![
			input.name,
			input.description,
			input.transport,
			input.command,
			input.args.to_string(),
			input.url,
			input.headers.to_string(),
			input.env.to_string(),
			now
		],
	)
	.map_err(|e| format!("创建 MCP 服务器失败: {e}"))?;
	Ok(conn.last_insert_rowid())
}

/// 更新服务器
pub fn update(conn: &Connection, id: i64, input: &McpServerInput, now: i64) -> Result<(), String> {
	conn.execute(
		"UPDATE mcp_servers SET name = ?1, description = ?2, transport = ?3, command = ?4, args = ?5, url = ?6, headers = ?7, env = ?8, updated_at = ?9 WHERE id = ?10",
		params![
			input.name,
			input.description,
			input.transport,
			input.command,
			input.args.to_string(),
			input.url,
			input.headers.to_string(),
			input.env.to_string(),
			now,
			id
		],
	)
	.map_err(|e| format!("更新 MCP 服务器失败: {e}"))?;
	Ok(())
}

/// 切换启用状态
pub fn set_enabled(conn: &Connection, id: i64, enabled: bool, now: i64) -> Result<(), String> {
	conn.execute(
		"UPDATE mcp_servers SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
		params![if enabled { 1 } else { 0 }, now, id],
	)
	.map_err(|e| format!("更新 MCP 服务器状态失败: {e}"))?;
	Ok(())
}

/// 删除服务器
pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
	conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
		.map_err(|e| format!("删除 MCP 服务器失败: {e}"))?;
	Ok(())
}
