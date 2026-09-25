//! <tool_call> 标签解析 (无 regex 依赖, 手写扫描)
//!
//! 支持: <tool_call name="x" args='{"a":1}'></tool_call>
//!        <tool_call name="x" args='{"a":1}' />

use serde_json::{json, Value};

/// 一次解析出的工具调用
#[derive(Debug, Clone)]
pub struct ParsedToolCall {
	pub name: String,
	pub args: Value,
}

/// 解析文本里的所有 <tool_call> 标签
pub fn parse_tool_calls(text: &str) -> Result<Vec<ParsedToolCall>, String> {
	let mut calls = Vec::new();
	let mut from = 0usize;
	let tag_start_marker = "<tool_call";
	while let Some(rel) = text[from..].find(tag_start_marker) {
		let start = from + rel;
		let tail = &text[start..];
		// 要求 "<tool_call" 后面是空白 / > / /, 避免误匹配 <tool_callabc>
		let after_name = &tail[tag_start_marker.len()..];
		let boundary_ok = matches!(after_name.chars().next(), Some(' ') | Some('\t') | Some('\n') | Some('\r') | Some('>') | Some('/'));
		if !boundary_ok {
			from = start + tag_start_marker.len();
			continue;
		}
		let Some(gt) = tail.find('>') else { break };
		let tag = &tail[..=gt];
		let Some(name) = extract_attr(tag, "name")
			.map(|s| s.trim().to_string())
			.filter(|name| !name.is_empty())
		else {
			from = start + gt + 1;
			continue;
		};
		let args = match extract_attr(tag, "args") {
			Some(raw) => serde_json::from_str(raw.trim())
				.map_err(|error| format!("工具「{name}」参数不是合法 JSON: {error}"))?,
			None => json!({}),
		};
		calls.push(ParsedToolCall { name, args });
		from = start + gt + 1;
	}
	Ok(calls)
}

#[cfg(test)]
mod tests {
	use super::parse_tool_calls;

	#[test]
	fn rejects_invalid_tool_arguments() {
		let error = parse_tool_calls(r#"<tool_call name="demo" args='{bad}'></tool_call>"#)
			.expect_err("invalid JSON must not be silently replaced");
		assert!(error.contains("参数不是合法 JSON"));
	}

	#[test]
	fn defaults_only_when_arguments_are_absent() {
		let calls = parse_tool_calls(r#"<tool_call name="demo"></tool_call>"#).unwrap();
		assert_eq!(calls.len(), 1);
		assert_eq!(calls[0].args, serde_json::json!({}));
	}
}

/// 从标签里提取 `key="..."` 或 `key='...'` 的属性值 (支持 key = "x" 空格)
fn extract_attr(tag: &str, key: &str) -> Option<String> {
	let mut from = 0usize;
	while from < tag.len() {
		let rel = tag[from..].find(key)?;
		let start = from + rel;
		let tail = tag[start + key.len()..].trim_start();
		let Some(after_eq) = tail.strip_prefix('=') else {
			from = start + key.len();
			continue;
		};
		let value = after_eq.trim_start();
		let quote = value.chars().next()?;
		if quote != '"' && quote != '\'' {
			return None;
		}
		let inner = &value[quote.len_utf8()..];
		let end = inner.find(quote)?;
		return Some(inner[..end].to_string());
	}
	None
}
