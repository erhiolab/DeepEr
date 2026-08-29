//! 定时任务定义

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 一条定时任务记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
	pub id: i64,
	/// 任务名称
	pub title: String,
	/// 到点后发给 AI 的内容
	pub content: String,
	/// 任务类型: permanent(永久, 按循环重复) / once(一次性, 只执行一次)
	pub kind: String,
	/// 时间设定 (JSON 数组): once/hourly/daily/weekly 条目, 一个任务可多个时间
	pub schedule: Value,
	/// 是否启用
	pub enabled: bool,
	pub created_at: i64,
	pub updated_at: i64,
}
