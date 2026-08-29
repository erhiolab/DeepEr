//! 上下文摘要命令模块

use crate::db;
use crate::memory::summaries::{self, SummaryInput, SummaryRecord};

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 摘要列表 (最新的在前)
/// invoke("summary_list", { limit: 100 })
#[tauri::command]
pub fn summary_list(
	state: tauri::State<'_, db::Db>,
	limit: Option<u32>,
) -> Result<Vec<SummaryRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	summaries::list(&conn, limit.unwrap_or(100).clamp(1, 500) as usize)
}

/// 新建摘要
/// invoke("summary_create", { args: { startContextId, endContextId, level, content, tokenCount } })
#[tauri::command]
pub fn summary_create(
	state: tauri::State<'_, db::Db>,
	args: SummaryInput,
) -> Result<SummaryRecord, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let id = summaries::create(&conn, &args, now())?;
	// 读回完整记录
	let mut stmt = conn
		.prepare(&format!(
			"SELECT id, start_context_id, end_context_id, level, content, token_count, status, created_at FROM summaries WHERE id = ?1"
		))
		.map_err(|e| format!("查询摘要失败: {e}"))?;
	let mut rows = stmt
		.query_map(rusqlite::params![id], |row| {
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
		})
		.map_err(|e| format!("查询摘要失败: {e}"))?;
	match rows.next() {
		Some(Ok(summary)) => Ok(summary),
		Some(Err(e)) => Err(format!("解析摘要失败: {e}")),
		None => Err("摘要创建失败".to_string()),
	}
}

/// 删除摘要
/// invoke("summary_delete", { id })
#[tauri::command]
pub fn summary_delete(state: tauri::State<'_, db::Db>, id: i64) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	summaries::delete(&conn, id)
}
