//! Agent 循环命令
//!
//! 前端只需 invoke("agent_run", { args: { messages, requestId } }),
//! LLM 多轮工具调用循环、执行、留痕全部在 Rust 侧完成.

use crate::agent::run::{run_agent, AgentRunArgs, AgentRunOutcome};
use crate::db;

/// 运行 Agent 循环
/// invoke("agent_run", { args: { messages: [{role, content}], requestId } })
#[tauri::command]
pub async fn agent_run(
	app: tauri::AppHandle,
	state: tauri::State<'_, db::Db>,
	args: AgentRunArgs,
) -> Result<AgentRunOutcome, String> {
	run_agent(app, state, args).await
}
