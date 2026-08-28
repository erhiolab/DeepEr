//! ToolService: 统一工具调度
//!
//! 调用链: 查定义 (Definition Registry) → 启用校验 → JSON Schema 校验 →
//! Provider 分派 (目前只有 internal) → RuntimeRegistry 执行.

use rusqlite::Connection;
use serde_json::Value;
use std::sync::OnceLock;

use crate::tool::handler::RuntimeRegistry;
use crate::tool::repository;

/// 全局 ToolService (运行时注册表只需构建一次)
static TOOL_SERVICE: OnceLock<ToolService> = OnceLock::new();

/// 工具服务
pub struct ToolService {
	runtime: RuntimeRegistry,
}

impl ToolService {
	/// 全局单例 (内部工具注册表)
	pub fn global() -> &'static ToolService {
		TOOL_SERVICE.get_or_init(ToolService::new)
	}

	/// 新建服务 (测试/复用用)
	pub fn new() -> Self {
		Self {
			runtime: RuntimeRegistry::new(),
		}
	}

	/// 执行一次工具调用
	pub fn execute(&self, conn: &Connection, tool_name: &str, args: Value) -> Result<Value, String> {
		let definition = repository::get_by_name(conn, tool_name)?
			.ok_or_else(|| format!("未找到工具「{tool_name}」, 请先使用 tool-search 搜索可用工具"))?;
		if !definition.enabled {
			return Err(format!("工具「{tool_name}」已禁用"));
		}
		validate_input(&definition.input_schema, &args)?;

		match definition.provider.as_str() {
			"internal" => self.runtime.execute(conn, &definition.executor, args),
			other => Err(format!("暂不支持的工具 Provider: {other}")),
		}
	}
}

impl Default for ToolService {
	fn default() -> Self {
		Self::new()
	}
}

/// 简易 JSON Schema 校验: 必须为对象; required 字段存在; 已有值的类型匹配
fn validate_input(schema: &Value, args: &Value) -> Result<(), String> {
	let Some(props) = schema.get("properties").and_then(|p| p.as_object()) else {
		return Ok(());
	};
	let Some(args_obj) = args.as_object() else {
		return Err("工具参数必须是 JSON 对象".to_string());
	};

	if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
		for key in required {
			let Some(key) = key.as_str() else { continue };
			if !args_obj.contains_key(key) {
				return Err(format!("参数缺失: {key}"));
			}
		}
	}

	for (key, prop) in props {
		let Some(value) = args_obj.get(key) else { continue };
		let Some(expected) = prop.get("type").and_then(|t| t.as_str()) else { continue };
		let matched = match expected {
			"string" => value.is_string(),
			"integer" => value.is_u64() || value.is_i64(),
			"number" => value.is_number(),
			"boolean" => value.is_boolean(),
			"array" => value.is_array(),
			"object" => value.is_object(),
			_ => true,
		};
		if !matched {
			return Err(format!("参数 {key} 类型应为 {expected}"));
		}
	}
	Ok(())
}
