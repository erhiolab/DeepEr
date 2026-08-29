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
	id: i64,
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
			"SELECT id, type, role, content, token_count
			 FROM contexts
			 ORDER BY id DESC
			 LIMIT 200",
		)
		.map_err(|e| format!("查询上下文失败: {e}"))?;
	let rows = stmt
		.query_map([], |row| {
			Ok(ContextRow {
				id: row.get(0)?,
				kind: row.get(1)?,
				role: row.get(2)?,
				content: row.get(3)?,
				token_count: row.get(4)?,
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
	// 预算截断时记录最旧保留记录的 id, 用于注入覆盖更早范围的历史摘要
	let mut oldest_kept_id: Option<i64> = None;
	let mut truncated = false;

	// 从最新向前累积, 直到预算耗尽 (talks 为最新在前)
	for row in talks.iter() {
		let row_cost = cost(row);
		if !messages.is_empty() && used + row_cost > budget {
			truncated = true;
			break;
		}
		used += row_cost;
		oldest_kept_id = Some(row.id);
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

	// 历史摘要注入: 预算截断丢掉了更早的历史, 且存在覆盖更早范围的摘要时,
	// 在人设之后注入一段压缩摘要 (替代被截断的原始历史)
	if truncated {
		if let Some(oldest_id) = oldest_kept_id {
			if let Some(summary) = find_summary_before(conn, oldest_id)? {
				let content: String = summary.content.chars().take(600).collect();
				let message = LlmMessage {
					role: "system".to_string(),
					content: format!("[历史摘要] {content}"),
				};
				messages.insert(persons.len(), message);
			}
		}
	}

	let hit_rate = if total > 0 {
		(used as f64 / total as f64).min(1.0)
	} else {
		1.0
	};
	Ok((messages, hit_rate))
}

/// 查找覆盖指定 id 之前范围的最近一条摘要 (end_context_id < before_id)
fn find_summary_before(conn: &Connection, before_id: i64) -> Result<Option<SummaryRow>, String> {
	let mut stmt = conn
		.prepare(
			"SELECT id, start_context_id, end_context_id, level, content, token_count, status, created_at
			 FROM summaries
			 WHERE status = 'active' AND end_context_id < ?1
			 ORDER BY end_context_id DESC, level ASC
			 LIMIT 1",
		)
		.map_err(|e| format!("查询摘要失败: {e}"))?;
	let mut rows = stmt
		.query_map(rusqlite::params![before_id], |row| {
			Ok(SummaryRow {
				id: row.get(0)?,
				start_context_id: row.get(1)?,
				end_context_id: row.get(2)?,
				level: row.get(3)?,
				content: row.get(4)?,
				token_count: row.get(5)?,
				status: row.get(6)?,
				created_at: row.get(7)?,
			})
		})
		.map_err(|e| format!("查询摘要失败: {e}"))?;
	match rows.next() {
		Some(Ok(summary)) => Ok(Some(summary)),
		Some(Err(e)) => Err(format!("解析摘要失败: {e}")),
		None => Ok(None),
	}
}

/// 摘要行 (上下文构建用)
struct SummaryRow {
	#[allow(dead_code)]
	id: i64,
	#[allow(dead_code)]
	start_context_id: i64,
	#[allow(dead_code)]
	end_context_id: i64,
	#[allow(dead_code)]
	level: i64,
	content: String,
	#[allow(dead_code)]
	token_count: i64,
	#[allow(dead_code)]
	status: String,
	#[allow(dead_code)]
	created_at: i64,
}
