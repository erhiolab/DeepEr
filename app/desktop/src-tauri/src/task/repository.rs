//! tasks 表数据访问

use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

use crate::task::model::TaskRecord;

const TASK_COLUMNS: &str = "id, title, content, kind, schedule, enabled, created_at, updated_at";

fn parse_json(raw: Option<String>) -> Value {
	raw.and_then(|s| serde_json::from_str(&s).ok())
		.unwrap_or_else(|| json!([]))
}

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<TaskRecord> {
	Ok(TaskRecord {
		id: row.get(0)?,
		title: row.get(1)?,
		content: row.get(2)?,
		kind: row.get(3)?,
		schedule: parse_json(row.get(4)?),
		enabled: row.get::<_, i64>(5)? != 0,
		created_at: row.get(6)?,
		updated_at: row.get(7)?,
	})
}

fn query_all(conn: &Connection, sql: &str) -> Result<Vec<TaskRecord>, String> {
	let mut stmt = conn
		.prepare(sql)
		.map_err(|e| format!("查询定时任务失败: {e}"))?;
	let rows = stmt
		.query_map([], row_to_task)
		.map_err(|e| format!("查询定时任务失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析定时任务失败: {e}"))?;
	Ok(rows)
}

/// 全部任务
pub fn list(conn: &Connection) -> Result<Vec<TaskRecord>, String> {
	query_all(conn, &format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY id ASC"))
}

/// 已启用任务 (调度器用)
pub fn list_enabled(conn: &Connection) -> Result<Vec<TaskRecord>, String> {
	query_all(conn, &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE enabled = 1 ORDER BY id ASC"))
}

/// 按 id 查任务
pub fn get(conn: &Connection, id: i64) -> Result<Option<TaskRecord>, String> {
	let mut stmt = conn
		.prepare(&format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"))
		.map_err(|e| format!("查询定时任务失败: {e}"))?;
	let mut rows = stmt
		.query_map(params![id], row_to_task)
		.map_err(|e| format!("查询定时任务失败: {e}"))?;
	match rows.next() {
		Some(Ok(task)) => Ok(Some(task)),
		Some(Err(e)) => Err(format!("解析定时任务失败: {e}")),
		None => Ok(None),
	}
}

/// 新建任务, 返回新 id
pub fn create(
	conn: &Connection,
	title: &str,
	content: &str,
	kind: &str,
	schedule: &Value,
	timestamp: i64,
) -> Result<i64, String> {
	conn.execute(
		"INSERT INTO tasks (title, content, kind, schedule, enabled, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
		params![title, content, kind, schedule.to_string(), timestamp],
	)
	.map_err(|e| format!("创建定时任务失败: {e}"))?;
	Ok(conn.last_insert_rowid())
}

/// 更新任务
pub fn update(
	conn: &Connection,
	id: i64,
	title: &str,
	content: &str,
	kind: &str,
	schedule: &Value,
	timestamp: i64,
) -> Result<(), String> {
	conn.execute(
		"UPDATE tasks SET title = ?1, content = ?2, kind = ?3, schedule = ?4, updated_at = ?5 WHERE id = ?6",
		params![title, content, kind, schedule.to_string(), timestamp, id],
	)
	.map_err(|e| format!("更新定时任务失败: {e}"))?;
	Ok(())
}

/// 切换启用状态
pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<(), String> {
	conn.execute(
		"UPDATE tasks SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
		params![if enabled { 1 } else { 0 }, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0), id],
	)
	.map_err(|e| format!("更新定时任务状态失败: {e}"))?;
	Ok(())
}

/// 删除任务
pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
	conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
		.map_err(|e| format!("删除定时任务失败: {e}"))?;
	Ok(())
}
