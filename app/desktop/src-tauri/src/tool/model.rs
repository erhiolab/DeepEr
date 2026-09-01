//! 工具定义模型 (与前端 ToolDefinition 接口 camelCase 对齐)

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 一条工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
	/// 唯一 id
	pub id: i64,
	/// 英文调用名 (AI / Runtime 调用时使用), 如 `tool-search`
	pub name: String,
	/// 中文标题 (界面展示), 如 `工具-搜索工具`
	pub label: String,
	/// 用途 / 参数 / 调用方式说明
	pub description: String,
	/// 搜索别名 (AI 搜索关键词, 每行/逗号一个; 前端可编辑)
	pub keywords: Vec<String>,
	/// Provider 类型: internal / http / mcp / plugin
	pub provider: String,
	/// Provider 内部的执行目标 (internal 时即 Handler 名)
	pub executor: String,
	/// JSON Schema (入参校验)
	pub input_schema: Value,
	/// Provider 专属配置 (如 http 的 url)
	pub config: Value,
	/// 是否启用
	pub enabled: bool,
	/// 是否内置工具
	pub builtin: bool,
	/// 工具版本
	pub version: String,
	pub created_at: i64,
	pub updated_at: i64,
}
