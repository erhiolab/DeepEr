//! memories / memory_tags 表数据访问

use rusqlite::{params, Connection, Row};

use crate::memory::model::{MemoryInput, MemoryRecord};

/// 记忆查询 (含标签聚合)
const MEMORY_SELECT: &str = "
	SELECT
		m.id, m.content, m.type, m.importance, m.confidence, m.access_count,
		m.last_accessed_at, m.expires_at, m.status, m.created_at, m.updated_at,
		(SELECT GROUP_CONCAT(tag, ',') FROM memory_tags t WHERE t.memory_id = m.id) AS tags
	FROM memories m
";

fn parse_tags(raw: Option<String>) -> Vec<String> {
	raw.map(|text| {
		text.split(',')
			.map(str::trim)
			.filter(|tag| !tag.is_empty())
			.map(String::from)
			.collect()
	})
	.unwrap_or_default()
}

fn row_to_memory(row: &Row<'_>) -> rusqlite::Result<MemoryRecord> {
	Ok(MemoryRecord {
		id: row.get(0)?,
		content: row.get(1)?,
		r#type: row.get(2)?,
		importance: row.get(3)?,
		confidence: row.get(4)?,
		access_count: row.get(5)?,
		last_accessed_at: row.get(6)?,
		expires_at: row.get(7)?,
		status: row.get(8)?,
		created_at: row.get(9)?,
		updated_at: row.get(10)?,
		tags: parse_tags(row.get(11)?),
		recall_score: None,
	})
}

fn query_all(conn: &Connection, sql: &str, limit: usize) -> Result<Vec<MemoryRecord>, String> {
	let mut stmt = conn
		.prepare(sql)
		.map_err(|e| format!("查询记忆失败: {e}"))?;
	let rows = stmt
		.query_map(params![limit as i64], row_to_memory)
		.map_err(|e| format!("查询记忆失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析记忆失败: {e}"))?;
	Ok(rows)
}

/// 全部有效记忆 (按创建时间倒序)
pub fn list(conn: &Connection, limit: usize) -> Result<Vec<MemoryRecord>, String> {
	query_all(
		conn,
		&format!("{MEMORY_SELECT} WHERE m.status = 'active' ORDER BY m.created_at DESC LIMIT ?1"),
		limit,
	)
}

/// 关键词搜索 (内容 / 标签命中, 按回忆打分排序)
pub fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<MemoryRecord>, String> {
	let mut stmt = conn
		.prepare(&format!(
			"{MEMORY_SELECT}
			 WHERE m.status = 'active'
			   AND (instr(lower(m.content), lower(?1)) > 0
			     OR EXISTS (SELECT 1 FROM memory_tags t2 WHERE t2.memory_id = m.id AND instr(lower(t2.tag), lower(?1)) > 0))
			 ORDER BY m.updated_at DESC
			 LIMIT ?2"
		))
		.map_err(|e| format!("搜索记忆失败: {e}"))?;
	let rows = stmt
		.query_map(params![query, limit as i64], row_to_memory)
		.map_err(|e| format!("搜索记忆失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析记忆失败: {e}"))?;
	Ok(rows)
}

/// 按 id 查记忆
pub fn get(conn: &Connection, id: i64) -> Result<Option<MemoryRecord>, String> {
	let mut stmt = conn
		.prepare(&format!("{MEMORY_SELECT} WHERE m.id = ?1"))
		.map_err(|e| format!("查询记忆失败: {e}"))?;
	let mut rows = stmt
		.query_map(params![id], row_to_memory)
		.map_err(|e| format!("查询记忆失败: {e}"))?;
	match rows.next() {
		Some(Ok(memory)) => Ok(Some(memory)),
		Some(Err(e)) => Err(format!("解析记忆失败: {e}")),
		None => Ok(None),
	}
}

/// 新建记忆, 返回新 id
pub fn create(conn: &Connection, input: &MemoryInput, now: i64) -> Result<i64, String> {
	conn.execute(
		"INSERT INTO memories (content, type, importance, confidence, access_count, last_accessed_at, expires_at, status, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, 0, NULL, ?5, 'active', ?6, ?6)",
		params![
			input.content,
			input.r#type,
			input.importance,
			input.confidence,
			input.expires_at,
			now
		],
	)
	.map_err(|e| format!("创建记忆失败: {e}"))?;
	let id = conn.last_insert_rowid();
	replace_tags(conn, id, &input.tags)?;
	Ok(id)
}

/// 更新记忆 (整体覆盖)
pub fn update(conn: &Connection, id: i64, input: &MemoryInput, now: i64) -> Result<(), String> {
	conn.execute(
		"UPDATE memories SET content = ?1, type = ?2, importance = ?3, confidence = ?4, expires_at = ?5, updated_at = ?6 WHERE id = ?7",
		params![
			input.content,
			input.r#type,
			input.importance,
			input.confidence,
			input.expires_at,
			now,
			id
		],
	)
	.map_err(|e| format!("更新记忆失败: {e}"))?;
	replace_tags(conn, id, &input.tags)?;
	Ok(())
}

/// 删除记忆 (硬删除, 连同标签)
pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
	conn.execute("DELETE FROM memory_tags WHERE memory_id = ?1", params![id])
		.map_err(|e| format!("删除记忆标签失败: {e}"))?;
	conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
		.map_err(|e| format!("删除记忆失败: {e}"))?;
	Ok(())
}

/// 替换记忆标签
fn replace_tags(conn: &Connection, id: i64, tags: &[String]) -> Result<(), String> {
	conn.execute("DELETE FROM memory_tags WHERE memory_id = ?1", params![id])
		.map_err(|e| format!("更新记忆标签失败: {e}"))?;
	for tag in tags {
		conn.execute(
			"INSERT INTO memory_tags (memory_id, tag) VALUES (?1, ?2)",
			params![id, tag],
		)
		.map_err(|e| format!("更新记忆标签失败: {e}"))?;
	}
	Ok(())
}

/// 回忆一次: 访问次数 +1, 更新最后访问时间
pub fn touch(conn: &Connection, id: i64, now: i64) -> Result<(), String> {
	conn.execute(
		"UPDATE memories SET access_count = access_count + 1, last_accessed_at = ?1 WHERE id = ?2",
		params![now, id],
	)
	.map_err(|e| format!("更新记忆访问失败: {e}"))?;
	Ok(())
}
