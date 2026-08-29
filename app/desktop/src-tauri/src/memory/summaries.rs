//! 上下文摘要 (summaries 表)
//!
//! 参考 docs/记忆.md: 旧对话压缩为摘要, 摘要覆盖一段 contexts 的 id 范围 (start~end),
//! 分层 level 越高覆盖范围越大. 当前提供表结构与增删查, 自动生成留待后续阶段.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

/// 一条摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRecord {
	pub id: i64,
	pub start_context_id: i64,
	pub end_context_id: i64,
	pub level: i64,
	pub content: String,
	pub token_count: i64,
	pub status: String,
	pub created_at: i64,
}

/// 摘要写入参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryInput {
	pub start_context_id: i64,
	pub end_context_id: i64,
	pub level: i64,
	pub content: String,
	pub token_count: i64,
}

const SUMMARY_COLUMNS: &str =
	"id, start_context_id, end_context_id, level, content, token_count, status, created_at";

fn row_to_summary(row: &Row<'_>) -> rusqlite::Result<SummaryRecord> {
	Ok(SummaryRecord {
		id: row.get(0)?,
		start_context_id: row.get(1)?,
		end_context_id: row.get(2)?,
		level: row.get(3)?,
		content: row.get(4)?,
		token_count: row.get(5)?,
		status: row.get(6)?,
		created_at: row.get(7)?,
	})
}

/// 摘要列表 (最新的在前)
pub fn list(conn: &Connection, limit: usize) -> Result<Vec<SummaryRecord>, String> {
	let mut stmt = conn
		.prepare(&format!(
			"SELECT {SUMMARY_COLUMNS} FROM summaries WHERE status = 'active' ORDER BY id DESC LIMIT ?1"
		))
		.map_err(|e| format!("查询摘要失败: {e}"))?;
	let rows = stmt
		.query_map(params![limit as i64], row_to_summary)
		.map_err(|e| format!("查询摘要失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析摘要失败: {e}"))?;
	Ok(rows)
}

/// 新建摘要
pub fn create(conn: &Connection, input: &SummaryInput, now: i64) -> Result<i64, String> {
	conn.execute(
		"INSERT INTO summaries (start_context_id, end_context_id, level, content, token_count, status, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)",
		params![
			input.start_context_id,
			input.end_context_id,
			input.level,
			input.content,
			input.token_count,
			now
		],
	)
	.map_err(|e| format!("创建摘要失败: {e}"))?;
	Ok(conn.last_insert_rowid())
}

/// 删除摘要
pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
	conn.execute("DELETE FROM summaries WHERE id = ?1", params![id])
		.map_err(|e| format!("删除摘要失败: {e}"))?;
	Ok(())
}
