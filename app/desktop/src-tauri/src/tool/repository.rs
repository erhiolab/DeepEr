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
	(
		"time-now",
		"时间-当前时间",
		"获取当前的日期、时间、星期与系统时区. 无参数.",
		"time-now",
		r#"{"type":"object","properties":{},"required":[]}"#,
		"{}",
	),
	(
		"time-today",
		"时间-今日概览",
		"获取今天的日期、星期, 以及今天是否周末/工作日. 无参数.",
		"time-today",
		r#"{"type":"object","properties":{},"required":[]}"#,
		"{}",
	),
	(
		"time-zone",
		"时间-时区",
		"获取系统当前时区名称与 UTC 偏移. 无参数.",
		"time-zone",
		r#"{"type":"object","properties":{},"required":[]}"#,
		"{}",
	),
	(
		"calculator",
		"工具-计算器",
		"安全计算数学表达式, 支持 + - * / % ^(幂) 与括号. 参数: expression(必填, 数学表达式字符串, 例如 \"(128 * 0.8 + 32) / 2\")",
		"calculator",
		r#"{"type":"object","properties":{"expression":{"type":"string","description":"数学表达式, 例如 (128 * 0.8 + 32) / 2"}},"required":["expression"]}"#,
		"{}",
	),
	(
		"data-json",
		"工具-JSON处理",
		"解析/校验 JSON、按路径查询字段、美化输出. 参数: action(必填, parse/query/stringify), data(必填, JSON 字符串), query(仅 query 需要, 路径如 $.users[0].name)",
		"data-json",
		r#"{"type":"object","properties":{"action":{"type":"string","description":"parse / query / stringify"},"data":{"type":"string","description":"JSON 字符串"},"query":{"type":"string","description":"查询路径, 如 $.users[0].name"}},"required":["action","data"]}"#,
		"{}",
	),
	(
		"data-text",
		"工具-文本处理",
		"文本模板替换、分割、合并. 参数: action(必填, template/split/merge), data(模板或要处理的文本), vars(仅 template, 变量对象), delimiter(分隔符, 默认换行), items(仅 merge, 文本数组)",
		"data-text",
		r#"{"type":"object","properties":{"action":{"type":"string","description":"template / split / merge"},"data":{"type":"string","description":"模板或文本"},"vars":{"type":"object","description":"模板变量"},"delimiter":{"type":"string","description":"分隔符"},"items":{"type":"array","description":"要合并的文本数组"}},"required":["action"]}"#,
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
