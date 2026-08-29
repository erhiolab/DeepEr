//! 记忆定义

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// 记忆类型白名单
pub const MEMORY_TYPES: &[&str] = &["fact", "preference", "project", "event", "relationship", "core"];

/// 一条长期记忆
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
	pub id: i64,
	/// 记忆内容
	pub content: String,
	/// 类型: fact / preference / project / event / relationship / core
	pub r#type: String,
	/// 重要性 0~1
	pub importance: f64,
	/// 置信度 0~1
	pub confidence: f64,
	/// 标签
	pub tags: Vec<String>,
	/// 被回忆次数 (强化)
	pub access_count: i64,
	pub last_accessed_at: Option<i64>,
	pub expires_at: Option<i64>,
	/// active / archived
	pub status: String,
	pub created_at: i64,
	pub updated_at: i64,
	/// 回忆打分 (仅搜索/召回时返回)
	#[serde(skip_serializing_if = "Option::is_none")]
	pub recall_score: Option<f64>,
}

/// 记忆写入参数 (创建 / 更新共用)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInput {
	pub content: String,
	pub r#type: String,
	pub importance: f64,
	pub confidence: f64,
	pub tags: Vec<String>,
	pub expires_at: Option<i64>,
}

impl MemoryInput {
	/// 归一化: 校验内容与类型, 裁剪重要性/置信度, 去重标签
	pub fn normalize(&self) -> Result<Self, String> {
		let content = self.content.trim();
		if content.is_empty() {
			return Err("记忆内容不能为空".to_string());
		}
		let r#type = if self.r#type.trim().is_empty() {
			"fact".to_string()
		} else if MEMORY_TYPES.contains(&self.r#type.trim()) {
			self.r#type.trim().to_string()
		} else {
			return Err(format!(
				"记忆类型无效: {}, 可选 {}",
				self.r#type,
				MEMORY_TYPES.join(" / ")
			));
		};
		let mut seen = HashSet::new();
		let tags: Vec<String> = self
			.tags
			.iter()
			.map(|tag| tag.trim().to_string())
			.filter(|tag| !tag.is_empty() && seen.insert(tag.clone()))
			.collect();
		Ok(MemoryInput {
			content: content.to_string(),
			r#type,
			importance: self.importance.clamp(0.0, 1.0),
			confidence: self.confidence.clamp(0.0, 1.0),
			tags,
			expires_at: self.expires_at,
		})
	}
}
