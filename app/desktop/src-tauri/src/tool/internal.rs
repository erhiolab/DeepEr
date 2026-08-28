//! 内置工具实现
//!
//! 新增内置工具: 新建结构体 + 实现 [`ToolHandler`] + 加进 [`builtin_handlers`],
//! 并在 [`crate::tool::repository`] 的内置种子表里登记定义.

use std::sync::Arc;

use chrono::{Datelike, Local, Weekday};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::tool::handler::ToolHandler;
use crate::tool::repository;

/// 工具-搜索工具: 按关键词搜索已注册工具
pub struct ToolSearchHandler;

impl ToolHandler for ToolSearchHandler {
	fn name(&self) -> &str {
		"tool-search"
	}

	fn execute(&self, conn: &Connection, args: Value) -> Result<Value, String> {
		let query = args
			.get("query")
			.and_then(|v| v.as_str())
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.ok_or_else(|| "参数缺失: query(搜索关键词) 为必填参数".to_string())?;
		let limit = args
			.get("limit")
			.and_then(|v| v.as_u64())
			.unwrap_or(10)
			.clamp(1, 200) as usize;
		let tools = repository::search(conn, query, limit)?;
		Ok(json!({ "tools": tools }))
	}
}

/// 工具-获取全部工具: 返回全部已注册工具清单
pub struct ToolListAllHandler;

impl ToolHandler for ToolListAllHandler {
	fn name(&self) -> &str {
		"tool-list-all"
	}

	fn execute(&self, conn: &Connection, args: Value) -> Result<Value, String> {
		let limit = args
			.get("limit")
			.and_then(|v| v.as_u64())
			.unwrap_or(50)
			.clamp(1, 200) as usize;
		let all = repository::list(conn)?;
		let total = all.len();
		let tools: Vec<_> = all.into_iter().take(limit).collect();
		Ok(json!({ "total": total, "tools": tools }))
	}
}

/// 全部内置 Handler (显式注册)
pub fn builtin_handlers() -> Vec<Arc<dyn ToolHandler>> {
	vec![
		Arc::new(ToolSearchHandler),
		Arc::new(ToolListAllHandler),
		Arc::new(TimeNowHandler),
		Arc::new(TimeTodayHandler),
		Arc::new(TimeZoneHandler),
		Arc::new(CalculatorHandler),
		Arc::new(DataJsonHandler),
		Arc::new(DataTextHandler),
	]
}

/// 星期中文名
fn weekday_zh(weekday: Weekday) -> &'static str {
	match weekday {
		Weekday::Mon => "星期一",
		Weekday::Tue => "星期二",
		Weekday::Wed => "星期三",
		Weekday::Thu => "星期四",
		Weekday::Fri => "星期五",
		Weekday::Sat => "星期六",
		Weekday::Sun => "星期日",
	}
}

/// 时区展示: 缩写 + UTC 偏移 (缩写缺失时只显示偏移)
fn timezone_label() -> String {
	let now = Local::now();
	let offset = now.format("%:z").to_string();
	let abbreviation = now.format("%Z").to_string();
	if abbreviation.is_empty() {
		format!("本地时区 (UTC{offset})")
	} else {
		format!("{abbreviation} (UTC{offset})")
	}
}

/// 时间-当前时间: 日期 + 时间 + 星期 + 时区
pub struct TimeNowHandler;

impl ToolHandler for TimeNowHandler {
	fn name(&self) -> &str {
		"time-now"
	}

	fn execute(&self, _conn: &Connection, _args: Value) -> Result<Value, String> {
		let now = Local::now();
		Ok(json!({
			"datetime": now.format("%Y-%m-%d %H:%M:%S").to_string(),
			"date": now.format("%Y-%m-%d").to_string(),
			"time": now.format("%H:%M:%S").to_string(),
			"weekday": weekday_zh(now.weekday()),
			"timezone": timezone_label(),
		}))
	}
}

/// 时间-今日概览: 日期 + 星期 + 是否周末 / 工作日
pub struct TimeTodayHandler;

impl ToolHandler for TimeTodayHandler {
	fn name(&self) -> &str {
		"time-today"
	}

	fn execute(&self, _conn: &Connection, _args: Value) -> Result<Value, String> {
		let now = Local::now();
		let weekday = now.weekday();
		let is_weekend = matches!(weekday, Weekday::Sat | Weekday::Sun);
		Ok(json!({
			"date": now.format("%Y-%m-%d").to_string(),
			"weekday": weekday_zh(weekday),
			"isWeekend": is_weekend,
			"isWorkday": !is_weekend,
		}))
	}
}

/// 时间-时区: 系统时区名称 + UTC 偏移
pub struct TimeZoneHandler;

impl ToolHandler for TimeZoneHandler {
	fn name(&self) -> &str {
		"time-zone"
	}

	fn execute(&self, _conn: &Connection, _args: Value) -> Result<Value, String> {
		Ok(json!({ "timezone": timezone_label() }))
	}
}

/// 取字符串参数 (支持中英文键名)
fn string_arg(args: &Value, keys: &[&str]) -> String {
	for key in keys {
		if let Some(value) = args.get(*key).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
			return value.to_string();
		}
	}
	String::new()
}

/// 简单安全表达式求值器 (递归下降, 支持 + - * / % ^ 与括号, 无第三方依赖)
struct Calc {
	chars: Vec<char>,
	pos: usize,
}

impl Calc {
	fn new(input: &str) -> Self {
		Self {
			chars: input.chars().collect(),
			pos: 0,
		}
	}

	fn skip_ws(&mut self) {
		while self.pos < self.chars.len() && self.chars[self.pos].is_whitespace() {
			self.pos += 1;
		}
	}

	fn peek(&mut self) -> Option<char> {
		self.skip_ws();
		self.chars.get(self.pos).copied()
	}

	fn expr(&mut self) -> Result<f64, String> {
		let mut value = self.term()?;
		loop {
			match self.peek() {
				Some('+') => {
					self.pos += 1;
					value += self.term()?;
				}
				Some('-') => {
					self.pos += 1;
					value -= self.term()?;
				}
				_ => break,
			}
		}
		Ok(value)
	}

	fn term(&mut self) -> Result<f64, String> {
		let mut value = self.power()?;
		loop {
			match self.peek() {
				Some('*') => {
					self.pos += 1;
					value *= self.power()?;
				}
				Some('/') => {
					self.pos += 1;
					let divisor = self.power()?;
					if divisor == 0.0 {
						return Err("除数不能为 0".to_string());
					}
					value /= divisor;
				}
				Some('%') => {
					self.pos += 1;
					let divisor = self.power()?;
					if divisor == 0.0 {
						return Err("取模的除数不能为 0".to_string());
					}
					value %= divisor;
				}
				_ => break,
			}
		}
		Ok(value)
	}

	fn power(&mut self) -> Result<f64, String> {
		let base = self.unary()?;
		if self.peek() == Some('^') {
			self.pos += 1;
			let exponent = self.power()?; // 右结合
			return Ok(base.powf(exponent));
		}
		Ok(base)
	}

	fn unary(&mut self) -> Result<f64, String> {
		match self.peek() {
			Some('-') => {
				self.pos += 1;
				Ok(-self.unary()?)
			}
			Some('+') => {
				self.pos += 1;
				self.unary()
			}
			_ => self.primary(),
		}
	}

	fn primary(&mut self) -> Result<f64, String> {
		self.skip_ws();
		match self.chars.get(self.pos) {
			Some('(') => {
				self.pos += 1;
				let value = self.expr()?;
				self.skip_ws();
				if self.chars.get(self.pos) != Some(&')') {
					return Err("缺少右括号 )".to_string());
				}
				self.pos += 1;
				Ok(value)
			}
			_ => self.number(),
		}
	}

	fn number(&mut self) -> Result<f64, String> {
		self.skip_ws();
		let start = self.pos;
		let mut has_dot = false;
		while let Some(c) = self.chars.get(self.pos).copied() {
			if c.is_ascii_digit() {
				self.pos += 1;
			} else if c == '.' && !has_dot {
				has_dot = true;
				self.pos += 1;
			} else {
				break;
			}
		}
		if self.pos == start {
			let bad = self.chars.get(self.pos).copied().unwrap_or(' ');
			return Err(format!("无法解析的字符: '{bad}'"));
		}
		let raw: String = self.chars[start..self.pos].iter().collect();
		raw.parse::<f64>().map_err(|_| format!("无效数字: {raw}"))
	}

	fn finish(mut self) -> Result<f64, String> {
		let value = self.expr()?;
		self.skip_ws();
		if self.pos < self.chars.len() {
			let rest: String = self.chars[self.pos..].iter().collect();
			return Err(format!("表达式末尾有多余内容: '{rest}'"));
		}
		Ok(value)
	}
}

/// 工具-计算器: 安全计算数学表达式
pub struct CalculatorHandler;

impl ToolHandler for CalculatorHandler {
	fn name(&self) -> &str {
		"calculator"
	}

	fn execute(&self, _conn: &Connection, args: Value) -> Result<Value, String> {
		let expression = string_arg(&args, &["expression", "表达式"]);
		if expression.is_empty() {
			return Err("参数缺失: expression(数学表达式) 为必填参数".to_string());
		}
		if expression.chars().count() > 200 {
			return Err("表达式过长(上限 200 字符)".to_string());
		}
		let result = Calc::new(&expression).finish()?;
		if !result.is_finite() {
			return Err("计算结果不是有效数字".to_string());
		}
		Ok(json!({ "expression": expression, "result": result }))
	}
}

/// 简易 JSON 路径查询: 支持 $.field, $.field[0], $['key'], $["key"] 组合
fn json_query_value<'a>(root: &'a Value, query: &str) -> Result<&'a Value, String> {
	let query = query.trim();
	if query.is_empty() {
		return Ok(root);
	}
	if !query.starts_with('$') {
		return Err("查询路径应以 $ 开头, 例如 $.users[0].name".to_string());
	}
	let rest = &query[1..];
	let mut current = root;
	let mut index = 0usize;
	while index < rest.len() {
		let c = rest[index..].chars().next().unwrap();
		if c == '.' {
			index += 1;
			let start = index;
			while index < rest.len() {
				let ch = rest[index..].chars().next().unwrap();
				if ch == '.' || ch == '[' {
					break;
				}
				index += ch.len_utf8();
			}
			let field = &rest[start..index];
			if field.is_empty() {
				return Err("查询路径格式错误".to_string());
			}
			current = current
				.get(field)
				.ok_or_else(|| format!("字段不存在: {field}"))?;
		} else if c == '[' {
			index += 1;
			let ch = rest[index..].chars().next().ok_or_else(|| "查询路径缺少 ]".to_string())?;
			if ch == '\'' || ch == '"' {
				index += ch.len_utf8();
				let start = index;
				while index < rest.len() && !rest[index..].starts_with(ch) {
					index += rest[index..].chars().next().unwrap().len_utf8();
				}
				if index >= rest.len() {
					return Err("查询路径缺少右引号".to_string());
				}
				let key = &rest[start..index];
				index += ch.len_utf8();
				if !rest[index..].starts_with(']') {
					return Err("查询路径缺少 ]".to_string());
				}
				index += 1;
				current = current
					.get(key)
					.ok_or_else(|| format!("字段不存在: {key}"))?;
			} else {
				let start = index;
				while index < rest.len() && rest[index..].chars().next().unwrap().is_ascii_digit() {
					index += 1;
				}
				if start == index {
					return Err("查询路径中的数组下标无效".to_string());
				}
				let array_index: usize = rest[start..index]
					.parse()
					.map_err(|_| "数组下标无效".to_string())?;
				if !rest[index..].starts_with(']') {
					return Err("查询路径缺少 ]".to_string());
				}
				index += 1;
				let array = current
					.as_array()
					.ok_or_else(|| "当前节点不是数组".to_string())?;
				current = array
					.get(array_index)
					.ok_or_else(|| format!("数组下标越界: {array_index}"))?;
			}
		} else {
			return Err(format!("查询路径格式错误: '{}'", &rest[index..]));
		}
	}
	Ok(current)
}

/// 工具-JSON处理: parse(解析/校验) / query(按路径查询) / stringify(美化输出)
pub struct DataJsonHandler;

impl ToolHandler for DataJsonHandler {
	fn name(&self) -> &str {
		"data-json"
	}

	fn execute(&self, _conn: &Connection, args: Value) -> Result<Value, String> {
		let action = string_arg(&args, &["action", "操作"]).to_lowercase();
		let data = string_arg(&args, &["data", "数据"]);
		if data.is_empty() {
			return Err("参数缺失: data(JSON 字符串) 为必填参数".to_string());
		}
		match action.as_str() {
			"parse" => {
				let value = serde_json::from_str::<Value>(&data)
					.map_err(|e| format!("JSON 解析失败: {e}"))?;
				Ok(json!({ "value": value }))
			}
			"query" => {
				let query = string_arg(&args, &["query", "路径"]);
				if query.is_empty() {
					return Err("参数缺失: query(查询路径) 为必填参数".to_string());
				}
				let root = serde_json::from_str::<Value>(&data)
					.map_err(|e| format!("JSON 解析失败: {e}"))?;
				let value = json_query_value(&root, &query)?.clone();
				Ok(json!({ "query": query, "value": value }))
			}
			"stringify" => {
				// data 可能是 JSON 字符串, 也可能是普通文本
				let value = serde_json::from_str::<Value>(&data).unwrap_or_else(|_| json!(data));
				let text = serde_json::to_string_pretty(&value)
					.map_err(|e| format!("JSON 序列化失败: {e}"))?;
				Ok(json!({ "text": text }))
			}
			_ => Err(format!("action 参数无效: {action}, 可选 parse / query / stringify")),
		}
	}
}

/// 工具-文本处理: template(模板变量替换) / split(分割) / merge(合并)
pub struct DataTextHandler;

impl ToolHandler for DataTextHandler {
	fn name(&self) -> &str {
		"data-text"
	}

	fn execute(&self, _conn: &Connection, args: Value) -> Result<Value, String> {
		let action = string_arg(&args, &["action", "操作"]).to_lowercase();
		match action.as_str() {
			"template" => {
				let data = string_arg(&args, &["data", "文本"]);
				if data.is_empty() {
					return Err("参数缺失: data(模板文本) 为必填参数".to_string());
				}
				let mut text = data;
				if let Some(vars) = args.get("vars").and_then(|v| v.as_object()) {
					for (key, value) in vars {
						let replacement = match value {
							Value::String(s) => s.clone(),
							other => other.to_string(),
						};
						text = text.replace(&format!("{{{{{key}}}}}"), &replacement); // {{key}}
						text = text.replace(&format!("{{{key}}}"), &replacement); // {key}
					}
				}
				Ok(json!({ "text": text }))
			}
			"split" => {
				let data = string_arg(&args, &["data", "文本"]);
				if data.is_empty() {
					return Err("参数缺失: data(要分割的文本) 为必填参数".to_string());
				}
				let delimiter = string_arg(&args, &["delimiter", "分隔符"]);
				let parts: Vec<&str> = if delimiter.is_empty() {
					data.lines().collect()
				} else {
					data.split(&delimiter).collect()
				};
				Ok(json!({ "parts": parts }))
			}
			"merge" => {
				let items: Vec<String> = match args.get("items").and_then(|v| v.as_array()) {
					Some(array) => array
						.iter()
						.map(|v| match v {
							Value::String(s) => s.clone(),
							other => other.to_string(),
						})
						.collect(),
					None => return Err("参数缺失: items(要合并的文本数组) 为必填参数".to_string()),
				};
				let delimiter = string_arg(&args, &["delimiter", "分隔符"]);
				let joined = items.join(if delimiter.is_empty() { "\n" } else { delimiter.as_str() });
				Ok(json!({ "text": joined }))
			}
			_ => Err(format!("action 参数无效: {action}, 可选 template / split / merge")),
		}
	}
}
