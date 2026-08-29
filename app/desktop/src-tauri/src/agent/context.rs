//! 上下文构造 (Context Builder)
//!
//! 与前端旧 buildTalkMessages 逻辑对齐: 从 contexts 表读取人设 (type=person) 与
//! 对话/触摸 (type=talk/touch) 历史, 按 token 预算从最新向前累积, 返回给 LLM 的消息列表与命中率.
//! 上下文构造整体在后端, 前端只传用户消息文本.

use rusqlite::Connection;

use crate::commands::llm::LlmMessage;

/// 给 LLM 的上下文 token 预算 (与旧前端一致)
pub const CONTEXT_TOKEN_BUDGET: u64 = 8000;

/// 一条 context 记录 (构建用)
struct ContextRow {
	kind: String,
	role: Option<String>,
	content: String,
	token_count: i64,
}

/// 粗略估算 token (中英混合按 4 字符 ≈ 1 token)
pub(crate) fn estimate_tokens(text: &str) -> u64 {
	((text.chars().count() as u64).div_ceil(4)).max(1)
}

/// 构建本次 LLM 请求的上下文
///
/// 返回 (消息列表, 上下文命中率): 命中率 = 实际用到的 token / 库中上下文 token.
pub fn build(conn: &Connection, budget: u64) -> Result<(Vec<LlmMessage>, f64), String> {
	let mut stmt = conn
		.prepare(
			"SELECT type, role, content, token_count
			 FROM contexts
			 ORDER BY id DESC
			 LIMIT 200",
		)
		.map_err(|e| format!("查询上下文失败: {e}"))?;
	let rows = stmt
		.query_map([], |row| {
			Ok(ContextRow {
				kind: row.get(0)?,
				role: row.get(1)?,
				content: row.get(2)?,
				token_count: row.get(3)?,
			})
		})
		.map_err(|e| format!("查询上下文失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析上下文失败: {e}"))?;

	// 人设 system 消息 (恒在最前, 不参与预算裁剪)
	let persons: Vec<&ContextRow> = rows
		.iter()
		.filter(|row| row.kind == "person" && !row.content.trim().is_empty())
		.collect();
	// 对话 / 触摸 / 定时任务历史 (按查询顺序为最新在前; 定时任务以独立 type 区分, 不混入用户输入)
	let talks: Vec<&ContextRow> = rows
		.iter()
		.filter(|row| {
			(row.kind == "talk" || row.kind == "touch" || row.kind == "schedule")
				&& row.role.as_deref().is_some_and(|role| !role.trim().is_empty())
				&& !row.content.trim().is_empty()
		})
		.collect();

	// 每条记录的 token 成本 (库中为 0 时用估算兜底)
	let cost = |row: &ContextRow| -> u64 {
		let stored = row.token_count.max(0) as u64;
		if stored > 0 {
			stored
		} else {
			estimate_tokens(&row.content)
		}
	};

	let mut total: u64 = talks.iter().map(|row| cost(row)).sum();
	let mut used: u64 = 0;
	let mut messages: Vec<LlmMessage> = Vec::new();

	// 从最新向前累积, 直到预算耗尽 (talks 为最新在前)
	for row in talks.iter() {
		let row_cost = cost(row);
		if !messages.is_empty() && used + row_cost > budget {
			break;
		}
		used += row_cost;
		let role = if row.role.as_deref() == Some("assistant") {
			"assistant"
		} else {
			"user"
		};
		messages.push(LlmMessage {
			role: role.to_string(),
			content: row.content.clone(),
		});
	}
	messages.reverse(); // 旧 → 新

	// 人设 system 消息恒在最前 (persons 最新在前, 反向遍历后最终最新者最前, 与旧前端一致)
	for person in persons.iter().rev() {
		let person_cost = cost(person);
		used += person_cost;
		total += person_cost;
		messages.insert(
			0,
			LlmMessage {
				role: "system".to_string(),
				content: person.content.clone(),
			},
		);
	}

	let hit_rate = if total > 0 {
		(used as f64 / total as f64).min(1.0)
	} else {
		1.0
	};
	Ok((messages, hit_rate))
}
