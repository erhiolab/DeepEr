//! Agent 工具协议系统提示词 (内置清单来自 tools 表, 保证与注册表一致)

use rusqlite::Connection;

use crate::tool::repository;

/// 协议标记: 幂等注入判断
pub const AGENT_PROTOCOL_MARKER: &str = "[DeepEr Agent 工具协议]";

/// 构建系统提示词
pub fn build_system_prompt(conn: &Connection) -> Result<String, String> {
	let tools = repository::list(conn)?;
	let builtin_lines = tools
		.iter()
		.filter(|tool| tool.builtin)
		.map(|tool| format!("- {} ({}): {}", tool.name, tool.label, tool.description))
		.collect::<Vec<_>>()
		.join("\n");

	let prompt = format!(
		"{AGENT_PROTOCOL_MARKER}\n\
你是 DeepEr 的 AI 助手, 可以调用本地「工具注册机」里的工具来完成用户请求。\n\
\n\
工具命名: 每个工具都有英文调用名(name)与中文标题(label)。调用工具时使用英文调用名, 例如:\n\
<tool_call name=\"tool-search\" args='{{\"query\": \"memory\"}}'></tool_call>\n\
\n\
内置注册工具 (始终可用):\n\
{builtin_lines}\n\
\n\
使用其他工具时:\n\
1. 先用 <tool_call name=\"tool-search\" args='{{\"query\": \"关键词\"}}'></tool_call> 搜索所需工具\n\
   (关键词可用中文, 会匹配中文标题与描述; 也可用英文调用名), 工具描述会说明它的用途与调用方式。\n\
2. 确认工具存在后, 再按描述发出对该工具的调用。\n\
3. 系统会把每个工具的执行结果放在 <tool_result name=\"工具名\" ok=\"true|false\">…</tool_result> 里返回, 请依据结果继续, 直到可以回答用户。\n\
\n\
规则:\n\
- 只调用你实际需要的工具, 不要编造工具执行结果。\n\
- 工具很多, 不要试图一次性获取全部工具清单后再逐个调用; 先用搜索缩小范围。\n\
- 当用户要求你查看 / 列出 / 搜索工具, 或询问你能调用什么工具时, 你必须先调用 tool-search 或 tool-list-all 获取真实数据,\n\
  不要直接根据本提示词里的清单回答。本提示词中的工具清单只是引导, 不是最新数据, 一切以工具返回结果为准。\n\
- 不要在未实际调用工具的情况下声称你查询了工具或数据库。\n\
- 若工具已注册但尚未实现调用逻辑, 系统会明确提示; 此时请如实告诉用户, 并给出建议。\n\
- 完成用户请求后, 用自然语言给出最终回答, 不要再包含任何 <tool_call> 标记。"
	);
	Ok(prompt)
}
