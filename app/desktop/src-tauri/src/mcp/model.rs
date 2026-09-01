//! MCP 服务器定义

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 一条 MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRecord {
	pub id: i64,
	/// 唯一名称
	pub name: String,
	pub description: String,
	/// 传输方式: stdio / sse
	pub transport: String,
	/// stdio: 启动命令
	pub command: String,
	/// stdio: 启动参数 (JSON 数组)
	pub args: Value,
	/// sse: 服务器地址
	pub url: String,
	/// sse: 请求头 (JSON 对象)
	pub headers: Value,
	/// stdio: 环境变量 (JSON 对象)
	pub env: Value,
	/// 是否启用
	pub enabled: bool,
	pub created_at: i64,
	pub updated_at: i64,
}

/// MCP 服务器写入参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
	pub name: String,
	pub description: String,
	pub transport: String,
	pub command: String,
	pub args: Value,
	pub url: String,
	pub headers: Value,
	pub env: Value,
}
