//! 长期记忆命令模块
//!
//! memories + memory_tags 表, 提供列表 / 搜索(回忆打分) / 创建 / 更新 / 删除.

use std::collections::HashSet;

use crate::db;
use crate::memory::model::{MemoryInput, MemoryRecord};
use crate::memory::{recall, repository};

/// 记忆类型白名单
const MEMORY_TYPES: &[&str] = &["fact", "preference", "project", "event", "relationship", "core"];

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 归一化写入参数 (裁剪重要性/置信度、去重标签)
fn normalize(input: &MemoryInput) -> Result<MemoryInput, String> {
	let content = input.content.trim();
	if content.is_empty() {
		return Err("记忆内容不能为空".to_string());
	}
	let r#type = if input.r#type.trim().is_empty() {
		"fact".to_string()
	} else if MEMORY_TYPES.contains(&input.r#type.trim()) {
		input.r#type.trim().to_string()
	} else {
		return Err(format!(
			"记忆类型无效: {}, 可选 {}",
			input.r#type,
			MEMORY_TYPES.join(" / ")
		));
	};
	let tags: Vec<String> = {
		let mut seen = HashSet::new();
		input
			.tags
			.iter()
			.map(|tag| tag.trim().to_string())
			.filter(|tag| !tag.is_empty() && seen.insert(tag.clone()))
			.collect()
	};
	Ok(MemoryInput {
		content: content.to_string(),
		r#type,
		importance: input.importance.clamp(0.0, 1.0),
		confidence: input.confidence.clamp(0.0, 1.0),
		tags,
		expires_at: input.expires_at,
	})
}

/// 全部记忆 (按创建时间倒序)
/// invoke("memory_list", { args: { limit: 200 } })
#[tauri::command]
pub fn memory_list(
	state: tauri::State<'_, db::Db>,
	limit: Option<u32>,
) -> Result<Vec<MemoryRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::list(&conn, limit.unwrap_or(200).clamp(1, 1000) as usize)
}

/// 搜索记忆 (内容 / 标签命中, 按回忆打分排序; 命中记忆访问次数 +1 强化)
/// invoke("memory_search", { args: { query: "项目", limit: 20 } })
#[tauri::command]
pub fn memory_search(
	state: tauri::State<'_, db::Db>,
	args: MemorySearchArgs,
) -> Result<Vec<MemoryRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let limit = args.limit.unwrap_or(20).clamp(1, 200) as usize;
	let query = args.query.trim();
	let mut memories = repository::search(&conn, query, limit)?;
	let timestamp = now();
	let mut scored: Vec<(f64, MemoryRecord)> = memories
		.drain(..)
		.map(|memory| {
			let score = recall::recall_score(query, &memory, timestamp);
			(score, memory)
		})
		.collect();
	scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
	// 命中记忆强化 (访问次数 +1)
	for (_, memory) in &scored {
		let _ = repository::touch(&conn, memory.id, timestamp);
	}
	Ok(scored
		.into_iter()
		.map(|(score, mut memory)| {
			memory.recall_score = Some(score);
			memory
		})
		.collect())
}

/// 新建记忆
/// invoke("memory_create", { args: { content, type, importance, confidence, tags, expiresAt? } })
#[tauri::command]
pub fn memory_create(
	state: tauri::State<'_, db::Db>,
	args: MemoryInput,
) -> Result<MemoryRecord, String> {
	let input = normalize(&args)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let id = repository::create(&conn, &input, now())?;
	repository::get(&conn, id)?.ok_or_else(|| "记忆创建失败".to_string())
}

/// 更新记忆
/// invoke("memory_update", { id, args: { ... } })
#[tauri::command]
pub fn memory_update(
	state: tauri::State<'_, db::Db>,
	id: i64,
	args: MemoryInput,
) -> Result<MemoryRecord, String> {
	let input = normalize(&args)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::update(&conn, id, &input, now())?;
	repository::get(&conn, id)?.ok_or_else(|| "记忆不存在".to_string())
}

/// 删除记忆
/// invoke("memory_delete", { id })
#[tauri::command]
pub fn memory_delete(state: tauri::State<'_, db::Db>, id: i64) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::delete(&conn, id)
}

/// 搜索参数
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchArgs {
	pub query: String,
	#[serde(default)]
	pub limit: Option<u32>,
}
