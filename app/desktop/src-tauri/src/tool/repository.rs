//! Definition Registry: tools 表内置种子 / 查询
//!
//! tools 表字段: name / label / description / provider / executor /
//! input_schema / config / enabled / builtin / version / created_at / updated_at.
//! 内置工具幂等 upsert (定义以代码为准, 每次启动刷新); 用户注册写入留给后续插件系统.
//! 软件未发布, 不做旧库迁移: 表结构以 db.rs SCHEMA 为准.

use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

use crate::tool::model::ToolDefinition;

/// 查询列
const TOOL_COLUMNS: &str =
	"id, name, label, description, provider, executor, input_schema, config, enabled, builtin, version, created_at, updated_at";

/// 当前时间戳 (秒)
fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 解析 JSON 列 (损坏时回退空对象)
fn parse_json(raw: Option<String>) -> Value {
	raw.and_then(|s| serde_json::from_str(&s).ok())
		.unwrap_or_else(|| json!({}))
}

/// 从 SQLite 行读取工具定义
fn row_to_definition(row: &Row<'_>) -> rusqlite::Result<ToolDefinition> {
	Ok(ToolDefinition {
		id: row.get(0)?,
		name: row.get(1)?,
		label: row.get(2)?,
		description: row.get(3)?,
		provider: row.get(4)?,
		executor: row.get(5)?,
		input_schema: parse_json(row.get(6)?),
		config: parse_json(row.get(7)?),
		enabled: row.get::<_, i64>(8)? != 0,
		builtin: row.get::<_, i64>(9)? != 0,
		version: row.get(10)?,
		created_at: row.get(11)?,
		updated_at: row.get(12)?,
	})
}

/// 内置工具种子: (name, label, description, executor, input_schema, config)
const BUILTIN_TOOLS: &[(&str, &str, &str, &str, &str, &str)] = &[
	(
		"tool-search",
		"工具-搜索工具",
		"按关键词搜索已注册工具, 返回匹配工具的名称(英文调用名)/中文标题与描述. 参数: query(必填, 搜索关键词, 可用中文或英文), limit(可选, 返回条数上限, 默认 10)",
		"tool-search",
		r#"{"type":"object","properties":{"query":{"type":"string","description":"搜索关键词, 可用中文或英文"},"limit":{"type":"integer","default":10,"description":"返回条数上限, 默认 10"}},"required":["query"]}"#,
		"{}",
	),
	(
		"tool-list-all",
		"工具-获取全部工具",
		"获取全部已注册工具清单(名称 + 中文标题 + 描述). 参数: limit(可选, 最多返回条数, 默认 50, 上限 200)",
		"tool-list-all",
		r#"{"type":"object","properties":{"limit":{"type":"integer","default":50,"description":"最多返回条数, 默认 50, 上限 200"}},"required":[]}"#,
		"{}",
	),
];

/// 初始化: 内置工具 upsert (幂等, 定义以代码为准)
pub fn init_defaults(conn: &Connection) -> rusqlite::Result<()> {
	let timestamp = now();
	for (name, label, description, executor, schema, config) in BUILTIN_TOOLS {
		conn.execute(
			"INSERT INTO tools (name, label, description, provider, executor, input_schema, config, enabled, builtin, version, created_at, updated_at)
			 VALUES (?1, ?2, ?3, 'internal', ?4, ?5, ?6, 1, 1, '1.0.0', ?7, ?7)
			 ON CONFLICT(name) DO UPDATE SET
				label = excluded.label,
				description = excluded.description,
				provider = excluded.provider,
				executor = excluded.executor,
				input_schema = excluded.input_schema,
				config = excluded.config,
				enabled = excluded.enabled,
				version = excluded.version,
				updated_at = excluded.updated_at",
			params![name, label, description, executor, schema, config, timestamp],
		)?;
	}
	Ok(())
}

/// 获取全部工具 (按调用名排序)
pub fn list(conn: &Connection) -> Result<Vec<ToolDefinition>, String> {
	query_all(conn, &format!("SELECT {TOOL_COLUMNS} FROM tools ORDER BY name ASC"))
}

/// 搜索工具 (调用名 / 中文标题 / 描述模糊匹配; 空关键词返回全部)
pub fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<ToolDefinition>, String> {
	let keyword = query.trim().to_lowercase();
	let limit = limit.clamp(1, 200) as i64;
	if keyword.is_empty() {
		return query_all(
			conn,
			&format!("SELECT {TOOL_COLUMNS} FROM tools ORDER BY name ASC LIMIT {limit}"),
		);
	}
	let mut stmt = conn
		.prepare(&format!(
			"SELECT {TOOL_COLUMNS} FROM tools
			 WHERE instr(lower(name), ?1) > 0
			    OR instr(lower(label), ?1) > 0
			    OR instr(lower(description), ?1) > 0
			 ORDER BY name ASC
			 LIMIT ?2"
		))
		.map_err(|e| format!("查询工具失败: {e}"))?;
	let rows = stmt
		.query_map(params![keyword, limit], row_to_definition)
		.map_err(|e| format!("查询工具失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析工具失败: {e}"))?;
	Ok(rows)
}

/// 按调用名查工具
pub fn get_by_name(conn: &Connection, name: &str) -> Result<Option<ToolDefinition>, String> {
	let mut stmt = conn
		.prepare(&format!("SELECT {TOOL_COLUMNS} FROM tools WHERE name = ?1"))
		.map_err(|e| format!("查询工具失败: {e}"))?;
	let mut rows = stmt
		.query_map(params![name], row_to_definition)
		.map_err(|e| format!("查询工具失败: {e}"))?;
	match rows.next() {
		Some(Ok(tool)) => Ok(Some(tool)),
		Some(Err(e)) => Err(format!("解析工具失败: {e}")),
		None => Ok(None),
	}
}

/// 执行一条返回多行的查询
fn query_all(conn: &Connection, sql: &str) -> Result<Vec<ToolDefinition>, String> {
	let mut stmt = conn
		.prepare(sql)
		.map_err(|e| format!("查询工具失败: {e}"))?;
	let rows = stmt
		.query_map([], row_to_definition)
		.map_err(|e| format!("查询工具失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析工具失败: {e}"))?;
	Ok(rows)
}
