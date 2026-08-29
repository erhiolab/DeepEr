//! 回忆打分
//!
//! 参考 docs/记忆.md: Recall Score = 0.50 语义 + 0.25 重要性 + 0.10 置信度 + 0.10 新鲜度 + 0.05 强化.
//! 第一阶段无向量检索, "语义" 用关键词命中 (内容 / 标签) 代替.

use crate::memory::model::MemoryRecord;

/// 新鲜度半衰期 (天): 越久没更新, 新鲜度越低
const RECENCY_HALF_LIFE_DAYS: f64 = 30.0;
/// 强化归一化: 访问多少次视为"充分强化"
const REINFORCE_NORMALIZE: f64 = 10.0;

/// 计算一条记忆的回忆打分
pub fn recall_score(query: &str, memory: &MemoryRecord, now: i64) -> f64 {
	// 语义/关键词命中
	let keyword_hit = if query.trim().is_empty() {
		1.0
	} else {
		let keyword = query.to_lowercase();
		let content_hit = memory.content.to_lowercase().contains(&keyword);
		let tag_hit = memory.tags.iter().any(|tag| tag.to_lowercase().contains(&keyword));
		if content_hit || tag_hit {
			1.0
		} else {
			0.0
		}
	};
	// 新鲜度: 指数衰减
	let age_days = (now.saturating_sub(memory.updated_at)) as f64 / 86400.0;
	let recency = (-age_days / RECENCY_HALF_LIFE_DAYS).exp();
	// 强化: 访问次数归一化
	let reinforcement = (memory.access_count as f64 / REINFORCE_NORMALIZE).min(1.0);
	let importance = memory.importance.clamp(0.0, 1.0);
	let confidence = memory.confidence.clamp(0.0, 1.0);

	0.50 * keyword_hit + 0.25 * importance + 0.10 * confidence + 0.10 * recency + 0.05 * reinforcement
}
