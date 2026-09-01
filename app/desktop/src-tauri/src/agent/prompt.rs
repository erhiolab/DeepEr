//! Agent 工具协议系统提示词
//!
//! 只完整列出核心工具 (tool-search / tool-list-all) 与重要工具 (时间 / 记忆),
//! 其余工具靠 tool-search 按需获取: 避免长清单稀释注意力, 同时保证
//! 「用户姓名/生日等美好回忆要主动存入长期记忆」「时间随时可查」这类能力始终可见.

use rusqlite::Connection;

use crate::tool::repository;

/// 协议标记: 幂等注入判断
pub const AGENT_PROTOCOL_MARKER: &str = "[DeepEr Agent 工具协议]";

/// 核心工具 (发现能力)
const CORE_TOOLS: &[&str] = &["tool-search", "tool-list-all"];

/// 重要工具 (始终可见: 时间感知 + 长期记忆)
const IMPORTANT_TOOLS: &[&str] = &[
	"time-now",
	"time-today",
	"time-zone",
	"memory-add",
	"memory-search",
	"memory-list",
	"memory-update",
	"memory-delete",
	"app-check-update",
	"app-update-apply",
];

/// 从 tools 表取指定工具的一行描述 (缺失跳过)
fn tool_line(tools: &[crate::tool::model::ToolDefinition], name: &str) -> Option<String> {
	tools.iter().find(|tool| tool.name == name).map(|tool| {
		format!("- {} ({}): {}", tool.name, tool.label, tool.description)
	})
}

/// 构建系统提示词
pub fn build_system_prompt(conn: &Connection) -> Result<String, String> {
	let tools = repository::list(conn)?;
	let core_lines = CORE_TOOLS
		.iter()
		.filter_map(|name| tool_line(&tools, name))
		.collect::<Vec<_>>()
		.join("\n");
	let important_lines = IMPORTANT_TOOLS
		.iter()
		.filter_map(|name| tool_line(&tools, name))
		.collect::<Vec<_>>()
		.join("\n");
	// 工具类别: 取中文标题第一段 (如 工具/时间/定时/记忆/FlyEnv), 去重排序后给 AI 当搜索路标
	let mut categories: Vec<String> = tools
		.iter()
		.filter_map(|tool| tool.label.split('-').next().map(|s| s.trim().to_string()))
		.filter(|s| !s.is_empty())
		.collect::<std::collections::HashSet<_>>()
		.into_iter()
		.collect();
	categories.sort();
	let categories_line = categories.join(" / ");
	let mcp_hint = "外部工具 (MCP): 接入的 MCP 服务器工具也会出现在工具库中, 调用名格式为「服务器名-工具名」, 不确定时先用 tool-search 搜索。";

	let prompt = format!(
		"{AGENT_PROTOCOL_MARKER}\n\
你是 DeepEr 的 AI 助手, 可以通过调用本地「工具注册机」里的工具来完成任务。\n\
\n\
调用语法 (每次调用独占一行):\n\
<tool_call name=\"工具名\" args='{{\"参数名\": \"参数值\"}}'></tool_call>\n\
\n\
工具命名: 每个工具都有英文调用名(name)与中文标题(label), 调用时使用英文调用名。\n\
\n\
	核心工具 (始终可用):\n\
	{core_lines}\n\
	\n\
	重要工具 (始终可用):\n\
	{important_lines}\n\
	\n\
	工具类别 (搜索工具时先用「类别 + 功能词」组合查询, 例如 定时/记忆/时间/计算 或 MCP 服务器名, 搜不到就换关键词):\n\
	{categories_line}\n\
	\n\
	{mcp_hint}\n\
	\n\
	长期记忆规则:\n\
- 用户的重要信息 (姓名、生日、偏好、约定、重要事件、美好回忆等) 应该用 memory-add 保存为长期记忆, 不要只停留在对话里。\n\
- 回答涉及用户个人情况时, 先用 memory-search 回忆相关记忆; 不确定就先搜索。\n\
- 如果用户提到了记忆里没有的重要信息, 主动用 memory-add 补充保存。\n\
\n\
更新规则:\n\
- 用户询问版本 / 更新 / 新功能时, 用 app-check-update 检查是否有新版本, 如实汇报。\n\
- 发现新版本时可以主动提醒用户更新, 但执行 app-update-apply 前必须先取得用户明确同意 (该操作会重启应用)。\n\
\n\
使用其他工具 (计算 / JSON / 文本 / 定时等) 的流程:\n\
1. 先用 <tool_call name=\"tool-search\" args='{{\"query\": \"关键词\"}}'></tool_call> 搜索所需能力。\n\
2. 按搜索结果发出对该工具的 <tool_call> 调用。\n\
3. 系统把执行结果放在 <tool_result name=\"工具名\" ok=\"true|false\">…</tool_result> 返回, 依据结果继续, 直到可以回答用户。\n\
\n\
规则 (必须严格遵守):\n\
- 用户要求执行任何操作 (查询 / 创建 / 修改 / 删除 / 搜索、查看时间、计算、解析数据、设置定时任务、保存记忆等) 时, 必须**先调用工具**拿到真实结果, 再回答。\n\
- 禁止凭空编造工具执行结果或声称完成了操作; 工具调用失败时如实告知用户失败原因。\n\
- 最终回答必须以 <tool_result> 实际返回内容为准; 任何 ok=\"false\" 的工具结果都意味着操作失败, 绝不能声称它成功。\n\
- 不确定用什么工具或参数时, 先 tool-search 搜索, 不要猜。\n\
- 完成用户请求后, 用自然语言给出最终回答, 不要再包含任何 <tool_call> 标记。"
	);
	Ok(prompt)
}
