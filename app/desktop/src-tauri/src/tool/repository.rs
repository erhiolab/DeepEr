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
	"id, name, label, description, keywords, provider, executor, input_schema, config, enabled, builtin, version, created_at, updated_at";

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

/// 解析搜索别名列: 按换行 / 逗号 / 顿号分隔, 去重去空
fn parse_keywords(raw: Option<String>) -> Vec<String> {
	let mut out: Vec<String> = Vec::new();
	if let Some(raw) = raw {
		// 统一中文逗号/顿号为英文逗号后按换行/逗号拆分
		let normalized = raw.replace("\u{ff0c}", ",").replace("\u{3001}", ",");
		for part in normalized.split(['\n', ',']) {
			let part = part.trim();
			if !part.is_empty() && !out.iter().any(|k| k == part) {
				out.push(part.to_string());
			}
		}
	}
	out
}

/// 别名列表转存储串 (换行分隔)
fn join_keywords(keywords: &[String]) -> String {
	keywords.join("\n")
}

/// 从 SQLite 行读取工具定义
fn row_to_definition(row: &Row<'_>) -> rusqlite::Result<ToolDefinition> {
	Ok(ToolDefinition {
		id: row.get(0)?,
		name: row.get(1)?,
		label: row.get(2)?,
		description: row.get(3)?,
		keywords: parse_keywords(row.get(4)?),
		provider: row.get(5)?,
		executor: row.get(6)?,
		input_schema: parse_json(row.get(7)?),
		config: parse_json(row.get(8)?),
		enabled: row.get::<_, i64>(9)? != 0,
		builtin: row.get::<_, i64>(10)? != 0,
		version: row.get(11)?,
		created_at: row.get(12)?,
		updated_at: row.get(13)?,
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
	(
		"schedule-create-once",
		"定时-新增一次性任务",
		"新建一个只执行一次的定时任务. 参数: title(必填, 任务名称), content(必填, 到点发给 AI 的内容), at(必填, 执行时间, Unix 秒或 'YYYY-MM-DD HH:MM:SS' 字符串)",
		"schedule-create-once",
		r#"{"type":"object","properties":{"title":{"type":"string","description":"任务名称"},"content":{"type":"string","description":"到点发给 AI 的内容"},"at":{"type":"string","description":"执行时间, Unix 秒或 YYYY-MM-DD HH:MM:SS"}},"required":["title","content","at"]}"#,
		"{}",
	),
	(
		"schedule-create-recurring",
		"定时-新增循环任务",
		"新建一个永久循环的定时任务. 参数: title(必填, 任务名称), content(必填, 到点发给 AI 的内容), cycle(必填, hourly/daily/weekly), minute(仅 hourly, 每小时的分钟 0~59), times(仅 daily/weekly, 时间点 HH:MM 数组或单个字符串), weekdays(仅 weekly, 星期 1~7 数组)",
		"schedule-create-recurring",
		r#"{"type":"object","properties":{"title":{"type":"string","description":"任务名称"},"content":{"type":"string","description":"到点发给 AI 的内容"},"cycle":{"type":"string","description":"hourly / daily / weekly"},"minute":{"type":"integer","description":"每小时的分钟 0~59"},"times":{"type":"array","description":"时间点 HH:MM 数组或单个字符串"},"weekdays":{"type":"array","description":"星期 1~7 数组"}},"required":["title","content","cycle"]}"#,
		"{}",
	),
	(
		"schedule-update",
		"定时-修改任务",
		"修改定时任务. 参数: id(必填, 任务 id), title/content/kind/schedule 均可选, 只更新提供的字段",
		"schedule-update",
		r#"{"type":"object","properties":{"id":{"type":"integer","description":"任务 id"},"title":{"type":"string"},"content":{"type":"string"},"kind":{"type":"string"},"schedule":{"type":"array"}},"required":["id"]}"#,
		"{}",
	),
	(
		"schedule-list",
		"定时-查询任务",
		"查询全部定时任务. 参数: enabled(可选, true/false 按启用状态过滤)",
		"schedule-list",
		r#"{"type":"object","properties":{"enabled":{"type":"boolean","description":"按启用状态过滤"}},"required":[]}"#,
		"{}",
	),
	(
		"schedule-delete",
		"定时-删除任务",
		"删除一个定时任务. 参数: id(必填, 任务 id)",
		"schedule-delete",
		r#"{"type":"object","properties":{"id":{"type":"integer","description":"任务 id"}},"required":["id"]}"#,
		"{}",
	),
	(
		"memory-add",
		"记忆-添加记忆",
		"保存一条长期记忆. 参数: content(必填, 记忆内容), type(可选, fact/preference/project/event/relationship/core, 默认 fact), importance(可选 0~1, 默认 0.5), confidence(可选 0~1, 默认 1.0), tags(可选, 标签数组)",
		"memory-add",
		r#"{"type":"object","properties":{"content":{"type":"string","description":"记忆内容"},"type":{"type":"string","description":"fact/preference/project/event/relationship/core"},"importance":{"type":"number","description":"0~1"},"confidence":{"type":"number","description":"0~1"},"tags":{"type":"array","description":"标签数组"}},"required":["content"]}"#,
		"{}",
	),
	(
		"memory-search",
		"记忆-搜索记忆",
		"按关键词回忆长期记忆 (内容/标签命中, 打分排序). 参数: query(必填, 关键词), limit(可选, 默认 5)",
		"memory-search",
		r#"{"type":"object","properties":{"query":{"type":"string","description":"搜索关键词"},"limit":{"type":"integer","description":"返回条数, 默认 5"}},"required":["query"]}"#,
		"{}",
	),
	(
		"memory-list",
		"记忆-获取全部记忆",
		"获取全部长期记忆清单. 参数: limit(可选, 默认 50, 上限 200)",
		"memory-list",
		r#"{"type":"object","properties":{"limit":{"type":"integer","description":"返回条数, 默认 50"}},"required":[]}"#,
		"{}",
	),
	(
		"memory-update",
		"记忆-更新记忆",
		"整体更新一条记忆. 参数: id(必填, 记忆 id), content/type/importance/confidence/tags 同 memory-add",
		"memory-update",
		r#"{"type":"object","properties":{"id":{"type":"integer","description":"记忆 id"},"content":{"type":"string"},"type":{"type":"string"},"importance":{"type":"number"},"confidence":{"type":"number"},"tags":{"type":"array"}},"required":["id","content"]}"#,
		"{}",
	),
	(
		"memory-delete",
		"记忆-删除记忆",
		"删除一条长期记忆. 参数: id(必填, 记忆 id)",
		"memory-delete",
		r#"{"type":"object","properties":{"id":{"type":"integer","description":"记忆 id"}},"required":["id"]}"#,
		"{}",
	),
	(
		"app-check-update",
		"应用-检查更新",
		"检查应用是否有新版本. 无参数. 返回当前版本 / 最新版本 / 是否有更新 / 更新说明",
		"app-check-update",
		r#"{"type":"object","properties":{},"required":[]}"#,
		"{}",
	),
	(
		"app-update-apply",
		"应用-更新应用",
		"下载并安装最新版本, 然后重启应用生效. 无参数. 注意: 此操作会重启应用, 调用前必须先询问并取得用户同意",
		"app-update-apply",
		r#"{"type":"object","properties":{},"required":[]}"#,
		"{}",
	),
];

/// 初始化: 内置工具 upsert (幂等, 定义以代码为准)
pub fn init_defaults(conn: &Connection) -> rusqlite::Result<()> {
	let timestamp = now();
	for (name, label, description, executor, schema, config) in BUILTIN_TOOLS {
		// 内置搜索别名种子: 仅在为空时写入, 保留用户在界面上编辑的别名
		let seed_keywords = BUILTIN_KEYWORDS
			.iter()
			.find(|(n, _)| n == name)
			.map(|(_, aliases)| aliases.join(","))
			.unwrap_or_default();
		conn.execute(
			"INSERT INTO tools (name, label, description, keywords, provider, executor, input_schema, config, enabled, builtin, version, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, 'internal', ?5, ?6, ?7, 1, 1, '1.0.0', ?8, ?8)
			 ON CONFLICT(name) DO UPDATE SET
				label = excluded.label,
				description = excluded.description,
				keywords = CASE WHEN tools.keywords = '' THEN excluded.keywords ELSE tools.keywords END,
				provider = excluded.provider,
				executor = excluded.executor,
				input_schema = excluded.input_schema,
				config = excluded.config,
				enabled = excluded.enabled,
				version = excluded.version,
				updated_at = excluded.updated_at",
			params![name, label, description, seed_keywords, executor, schema, config, timestamp],
		)?;
	}
	// 清理已下架的内置工具 (种子表里不再存在的 builtin 行, 如被拆分/替换的旧工具)
	let current_names: Vec<&str> = BUILTIN_TOOLS.iter().map(|tool| tool.0).collect();
	let placeholders = (0..current_names.len()).map(|_| "?").collect::<Vec<_>>().join(",");
	let sql = format!("DELETE FROM tools WHERE builtin = 1 AND name NOT IN ({placeholders})");
	let mut stmt = conn.prepare(&sql)?;
	stmt.execute(rusqlite::params_from_iter(current_names.iter()))?;
	Ok(())
}

/// 写入一条 MCP 同步工具 (provider=mcp, 幂等 upsert)
pub fn upsert_mcp_tool(
	conn: &Connection,
	name: &str,
	label: &str,
	description: &str,
	keywords: &str,
	executor: &str,
	schema: Value,
	config: Value,
	enabled: bool,
) -> Result<(), String> {
	let timestamp = now();
	conn.execute(
		"INSERT INTO tools (name, label, description, keywords, provider, executor, input_schema, config, enabled, builtin, version, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, 'mcp', ?5, ?6, ?7, ?8, 0, '1.0.0', ?9, ?9)
		 ON CONFLICT(name) DO UPDATE SET
			label = excluded.label,
			description = excluded.description,
			keywords = CASE WHEN tools.keywords = '' THEN excluded.keywords ELSE tools.keywords END,
			provider = excluded.provider,
			executor = excluded.executor,
			input_schema = excluded.input_schema,
			config = excluded.config,
			enabled = excluded.enabled,
			version = excluded.version,
			updated_at = excluded.updated_at",
		params![
			name,
			label,
			description,
			keywords,
			executor,
			schema.to_string(),
			config.to_string(),
			if enabled { 1 } else { 0 },
			timestamp
		],
	)
	.map_err(|e| format!("写入 MCP 工具失败: {e}"))?;
	Ok(())
}

/// 删除某 MCP 服务器的全部同步工具 (禁用/删除/重新同步前清理)
pub fn delete_mcp_tools_by_server(conn: &Connection, server_id: i64) -> Result<usize, String> {
	conn.execute(
		"DELETE FROM tools WHERE provider = 'mcp' AND json_extract(config, '$.serverId') = ?1",
		params![server_id],
	)
	.map_err(|e| format!("清理 MCP 工具失败: {e}"))
}

/// 统计某 MCP 服务器已同步的工具数量
pub fn count_mcp_tools_by_server(conn: &Connection, server_id: i64) -> Result<usize, String> {
	conn.query_row(
		"SELECT COUNT(*) FROM tools WHERE provider = 'mcp' AND json_extract(config, '$.serverId') = ?1",
		params![server_id],
		|row| row.get::<_, i64>(0),
	)
	.map(|count| count as usize)
	.map_err(|e| format!("统计 MCP 工具数量失败: {e}"))
}

/// 更新工具搜索别名 (前端'工具页'编辑, 换行分隔存储)
pub fn update_keywords(conn: &Connection, id: i64, keywords: &[String]) -> Result<(), String> {
	let timestamp = now();
	let joined = join_keywords(keywords);
	conn.execute(
		"UPDATE tools SET keywords = ?1, updated_at = ?2 WHERE id = ?3",
		params![joined, timestamp, id],
	)
	.map_err(|e| format!("更新搜索别名失败: {e}"))?;
	Ok(())
}

/// 获取全部工具 (按调用名排序)
pub fn list(conn: &Connection) -> Result<Vec<ToolDefinition>, String> {
	query_all(conn, &format!("SELECT {TOOL_COLUMNS} FROM tools ORDER BY name ASC"))
}

/// 内置工具搜索别名 (AI 常用说法, 弥补名称/描述缺少的关键词)
const BUILTIN_KEYWORDS: &[(&str, &[&str])] = &[
	("tool-search", &["搜索工具", "查找工具", "工具列表", "找工具", "search", "find"]),
	("tool-list-all", &["全部工具", "所有工具", "工具清单", "工具一览", "all", "list"]),
	("time-now", &["现在时间", "几点", "当前时间", "日期时间", "now", "date", "clock"]),
	("time-today", &["今天", "今日", "星期几", "今天星期", "today"]),
	("time-zone", &["时区", "utc", "偏移", "timezone"]),
	("calculator", &["数学", "计算器", "算术", "加减乘除", "求值", "运算", "math", "calc"]),
	("data-json", &["json", "解析", "校验", "查询字段", "格式化", "美化", "parse", "validate"]),
	("data-text", &["文本", "模板", "变量替换", "分割", "合并", "字符串", "template", "split", "merge"]),
	("schedule-create-once", &["定时", "一次性任务", "提醒", "闹钟", "计划", "once"]),
	("schedule-create-recurring", &["定时", "循环任务", "重复", "每天", "每周", "每小时", "周期", "recurring"]),
	("schedule-update", &["定时", "修改任务", "编辑任务", "改时间"]),
	("schedule-list", &["定时", "任务列表", "查询任务", "任务清单"]),
	("schedule-delete", &["定时", "删除任务", "取消任务"]),
	("memory-add", &["记忆", "记住", "保存信息", "重要信息", "提醒自己"]),
	("memory-search", &["记忆", "回忆", "搜索记忆", "想起", "查找记忆"]),
	("memory-list", &["记忆", "全部记忆", "记忆清单"]),
	("memory-update", &["记忆", "修改记忆", "更新记忆"]),
	("memory-delete", &["记忆", "删除记忆", "忘记"]),
	("app-check-update", &["更新", "版本", "检查更新", "新版本", "update"]),
	("app-update-apply", &["更新", "升级", "安装更新", "应用更新", "apply"]),
];

/// 查询分词: 按空白/标点切分, 中英文数字下划线保留 (CJK 连续串作为整体, 便于 2-gram 兜底)
fn tokenize_query(query: &str) -> Vec<String> {
	query
		.split(|c: char| !(c.is_alphanumeric() || c == '_'))
		.filter(|t| !t.is_empty())
		.map(|t| t.to_lowercase())
		.collect()
}

/// 判断 token 是否包含 CJK 字符 (中文搜索用 2-gram 兜底)
fn has_cjk(text: &str) -> bool {
	text.chars().any(|c| {
		matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF)
	})
}

/// 单 token 在某字段的最佳匹配分 (0 = 无匹配)
fn token_field_score(token: &str, name: &str, label: &str, description: &str, keywords: &[String]) -> i64 {
	let mut best = 0i64;
	if name.contains(token) {
		best = best.max(4);
	}
	if label.contains(token) {
		best = best.max(3);
	}
	if keywords.iter().any(|kw| kw.contains(token)) {
		best = best.max(2);
	}
	if description.contains(token) {
		best = best.max(1);
	}
	// 中文长串兜底: 2-gram 任一命中即算分
	if best == 0 && has_cjk(token) {
		let chars: Vec<char> = token.chars().collect();
		if chars.len() > 2 {
			for pair in chars.windows(2) {
				let bigram: String = pair.iter().collect();
				if name.contains(&bigram) {
					best = best.max(2);
				} else if label.contains(&bigram) {
					best = best.max(2);
				} else if keywords.iter().any(|kw| kw.contains(&bigram)) {
					best = best.max(1);
				} else if description.contains(&bigram) {
					best = best.max(1);
				}
				if best > 0 {
					break;
				}
			}
		}
	}
	best
}

/// 搜索工具: 分词多字段匹配 (调用名/中文标题/描述/别名), 命中词数优先 + 字段权重排序.
/// 解决 AI 用组合关键词 (如 "stop service") 搜不到工具的问题; 空关键词返回全部.
pub fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<ToolDefinition>, String> {
	let limit = limit.clamp(1, 200);
	let query = query.trim();
	if query.is_empty() {
		return query_all(
			conn,
			&format!("SELECT {TOOL_COLUMNS} FROM tools ORDER BY name ASC LIMIT {limit}"),
		);
	}
	let tokens = tokenize_query(query);
	if tokens.is_empty() {
		return Ok(Vec::new());
	}
	let all = query_all(conn, &format!("SELECT {TOOL_COLUMNS} FROM tools ORDER BY name ASC"))?;
	let mut scored: Vec<(i64, ToolDefinition)> = Vec::new();
	for tool in all {
		let name = tool.name.to_lowercase();
		let label = tool.label.to_lowercase();
		let description = tool.description.to_lowercase();
		let keywords: Vec<String> = tool.keywords.iter().map(|k| k.to_lowercase()).collect();
		let mut total = 0i64;
		let mut matched = 0usize;
		for token in &tokens {
			let score = token_field_score(token, &name, &label, &description, &keywords);
			if score > 0 {
				matched += 1;
			}
			total += score;
		}
		if matched > 0 {
			// 命中词数优先 (×100), 其次字段权重总分
			scored.push(((matched as i64) * 100 + total, tool));
		}
	}
	scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
	scored.truncate(limit);
	Ok(scored.into_iter().map(|(_, tool)| tool).collect())
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
