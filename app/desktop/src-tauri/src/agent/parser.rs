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
pub fn parse_tool_calls(text: &str) -> Vec<ParsedToolCall> {
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
		let name = extract_attr(tag, "name").map(|s| s.trim().to_string()).unwrap_or_default();
		if !name.is_empty() {
			let args = extract_attr(tag, "args")
				.and_then(|raw| serde_json::from_str(raw.trim()).ok())
				.unwrap_or_else(|| json!({}));
			calls.push(ParsedToolCall { name, args });
		}
		from = start + gt + 1;
	}
	calls
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
