//! Agent 循环 (Rust 侧)
//!
//! 流程: 注入工具协议 → LLM 生成 → 解析 <tool_call> → ToolService 执行 →
//! 以 <tool_result> 回填再次生成, 直到 LLM 不再发起调用 (有最大轮数与结果长度保护).
//! 每轮工具调用通过 `agent-tool-call` 事件推给前端展示, 并写入 contexts 表留痕.

use rusqlite::Connection;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::agent::context::{self, estimate_tokens, CONTEXT_TOKEN_BUDGET};
use crate::agent::parser;
use crate::agent::prompt;
use crate::commands::llm::{
	self, anthropic_messages, google_genai, openai_responses, LlmGenerateArgs, LlmGenerateOutcome, LlmMessage,
};
use crate::db;
use crate::log::{self, LogSource};
use crate::tool::service::ToolService;

/// 循环保护上限
const MAX_ROUNDS: usize = 6;
/// 单个工具结果最大字符数
const MAX_RESULT_CHARS: usize = 4000;
/// 上下文里最多保留几轮工具调用往返
const MAX_TOOL_PAIRS: usize = 2;
/// 工具调用事件名 (前端按 requestId 匹配)
const TOOL_EVENT: &str = "agent-tool-call";

/// 当前启用的 LLM 平台
#[derive(Debug, Clone, Copy, PartialEq)]
enum Platform {
	OpenAi,
	Anthropic,
	Google,
}

/// Agent 运行参数 (前端只传用户消息, 上下文构造在后端)
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunArgs {
	/// 用户消息列表 (可多条批量发送; 为空时只构建上下文, 用于人设首轮问候)
	#[serde(default)]
	pub messages: Vec<AgentUserMessage>,
	/// 前端生成的请求唯一标识 (用于匹配 tool 事件)
	#[serde(default)]
	pub request_id: Option<String>,
}

/// 一条用户消息
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUserMessage {
	/// 消息内容 (空串不写入 contexts)
	pub content: String,
	/// 消息类型: talk / touch (默认 talk)
	#[serde(default)]
	pub kind: Option<String>,
}

/// Agent 运行结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunOutcome {
	pub ok: bool,
	/// 最终回答 (成功时)
	#[serde(skip_serializing_if = "Option::is_none")]
	pub text: Option<String>,
	/// 失败原因 (LLM 请求失败时)
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	/// 全部轮次累计的真实 token
	pub input_tokens: Option<u64>,
	pub output_tokens: Option<u64>,
	/// 实际执行轮数 / 工具调用次数
	pub rounds: u32,
	pub calls: u32,
}

/// 一次工具执行结果 (内部)
#[derive(Clone)]
struct ExecResult {
	name: String,
	ok: bool,
	output: String,
}

/// 读取当前启用的 LLM 平台 (llm_adapter 配置键)
fn active_platform(state: &tauri::State<'_, db::Db>) -> Result<Platform, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let adapter = llm::read_db_string(&conn, "llm_adapter")?;
	drop(conn);
	match adapter.as_deref() {
		Some("openai-responses") => Ok(Platform::OpenAi),
		Some("anthropic-messages") => Ok(Platform::Anthropic),
		Some("google-genai") => Ok(Platform::Google),
		_ => Err("LLM 未启用".to_string()),
	}
}

/// 注入工具协议系统消息 (幂等; 插到所有人设 system 消息之后)
fn inject_protocol(mut messages: Vec<LlmMessage>) -> Vec<LlmMessage> {
	if messages
		.iter()
		.any(|m| m.role == "system" && m.content.starts_with(prompt::AGENT_PROTOCOL_MARKER))
	{
		return messages;
	}
	let insert_at = messages
		.iter()
		.rposition(|m| m.role == "system")
		.map(|i| i + 1)
		.unwrap_or(0);
	messages.insert(
		insert_at,
		LlmMessage {
			role: "system".to_string(),
			content: prompt::build_system_prompt(),
		},
	);
	messages
}

/// 调一次 LLM 生成 (按平台路由到对应后端命令)
async fn generate_round(
	platform: Platform,
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	messages: Vec<LlmMessage>,
) -> Result<LlmGenerateOutcome, String> {
	let args = LlmGenerateArgs {
		messages,
		model: None,
		temperature: None,
		max_tokens: None,
		request_id: None,
	};
	match platform {
		Platform::OpenAi => openai_responses::llm_openai_generate(app, state, args).await,
		Platform::Anthropic => anthropic_messages::llm_anthropic_generate(app, state, args).await,
		Platform::Google => google_genai::llm_google_generate(app, state, args).await,
	}
}

/// 截断超长文本 (保留首尾, 中间省略)
fn truncate(text: &str, max_chars: usize) -> String {
	let count = text.chars().count();
	if count <= max_chars {
		return text.to_string();
	}
	let half = max_chars / 2;
	let head: String = text.chars().take(half).collect();
	let tail: String = text.chars().rev().take(half).collect::<Vec<_>>().into_iter().rev().collect();
	format!("{head}\n…[已截断 {} 字符]…\n{tail}", count - max_chars)
}

/// 把工具执行结果包装成 <tool_result> 文本
fn format_results(results: &[ExecResult]) -> String {
	let body = results
		.iter()
		.map(|result| {
			format!(
				"<tool_result name=\"{}\" ok=\"{}\">\n{}\n</tool_result>",
				result.name,
				result.ok,
				truncate(&result.output, MAX_RESULT_CHARS)
			)
		})
		.collect::<Vec<_>>()
		.join("\n");
	let failed = results.iter().filter(|result| !result.ok).count();
	if failed > 0 {
		// 失败时在最前面加醒目系统警告, 防止模型无视失败结果编造成功
		format!(
			"[系统提示] 本轮有 {failed} 个工具调用失败 (ok=false)。你的最终回答必须以工具返回结果为准, 不得声称失败的操作已成功, 请如实告知用户失败原因。\n\n{body}"
		)
	} else {
		body
	}
}

/// 写一条 context 记录 (留痕)
fn insert_context(
	conn: &Connection,
	type_: &str,
	role: &str,
	content: &str,
	token_count: u64,
	input_tokens: Option<u64>,
	output_tokens: Option<u64>,
	hit_rate: Option<f64>,
) -> rusqlite::Result<()> {
	let now = std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0);
	conn.execute(
		"INSERT INTO contexts (type, role, content, token_count, input_tokens, output_tokens, hit_rate, created_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
		rusqlite::params![type_, role, content, token_count, input_tokens, output_tokens, hit_rate, now],
	)?;
	Ok(())
}

/// 记录一条 AI 回复 (成功/失败都留痕, 带真实 token 与上下文命中率)
fn record_assistant(
	state: &tauri::State<'_, db::Db>,
	text: &str,
	input_tokens: Option<u64>,
	output_tokens: Option<u64>,
	hit_rate: f64,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	insert_context(
		&conn,
		"talk",
		"assistant",
		text,
		output_tokens.unwrap_or_else(|| estimate_tokens(text)),
		input_tokens,
		output_tokens,
		Some(hit_rate),
	)
	.map_err(|e| format!("记录 AI 回复失败: {e}"))
}

/// 写入用户消息 + 构建上下文 (同步, 避免 DB 锁跨 await)
fn prepare_context(
	state: &tauri::State<'_, db::Db>,
	args: &AgentRunArgs,
) -> Result<(Vec<LlmMessage>, f64), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	for message in &args.messages {
		let content = message.content.trim();
		if content.is_empty() {
			continue;
		}
		insert_context(
			&conn,
			message.kind.as_deref().unwrap_or("talk"),
			"user",
			content,
			estimate_tokens(content),
			None,
			None,
			None,
		)
		.map_err(|e| format!("记录用户消息失败: {e}"))?;
	}
	context::build(&conn, CONTEXT_TOKEN_BUDGET)
}

/// 运行 Agent 循环 (非流式: 内部多轮调用, 完成后返回最终回答)
pub async fn run_agent(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	args: AgentRunArgs,
) -> Result<AgentRunOutcome, String> {
	let platform = active_platform(&state)?;
	let request_id = args.request_id.clone().unwrap_or_default();

	// 1. 写入用户消息 (后端统一留痕) + 构建上下文
	let (built, hit_rate) = prepare_context(&state, &args)?;
	if built.is_empty() {
		return Ok(AgentRunOutcome {
			ok: false,
			text: None,
			error: Some("上下文为空, 请先发送一条消息".to_string()),
			input_tokens: Some(0),
			output_tokens: Some(0),
			rounds: 0,
			calls: 0,
		});
	}
	let mut messages = inject_protocol(built);
	let has_protocol = messages
		.iter()
		.any(|m| m.role == "system" && m.content.starts_with(prompt::AGENT_PROTOCOL_MARKER));
	let _ = log::write(
		&app,
		&LogSource::Backend,
		"info",
		&format!("[agent] 上下文: 消息数={}, 含工具协议={}", messages.len(), has_protocol),
	);
	let base_len = messages.len();
	run_loop(app, state, platform, &mut messages, base_len, hit_rate, &request_id).await
}

/// 多轮循环: LLM 生成 → 工具执行 → <tool_result> 回填
async fn run_loop(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	platform: Platform,
	messages: &mut Vec<LlmMessage>,
	base_len: usize,
	hit_rate: f64,
	request_id: &str,
) -> Result<AgentRunOutcome, String> {
	let mut total_input: u64 = 0;
	let mut total_output: u64 = 0;
	let mut total_calls: u32 = 0;
	let mut previous_calls: Vec<String> = Vec::new();

	for round in 1..=MAX_ROUNDS {
		let outcome = generate_round(platform, app.clone(), state.clone(), messages.clone()).await?;
		total_input += outcome.input_tokens.unwrap_or(0);
		total_output += outcome.output_tokens.unwrap_or(0);

		if !outcome.ok {
			let error_text = outcome.error.clone().unwrap_or_else(|| "生成失败".to_string());
			record_assistant(&state, &error_text, None, None, hit_rate)?;
			return Ok(AgentRunOutcome {
				ok: false,
				text: None,
				error: Some(error_text),
				input_tokens: Some(total_input),
				output_tokens: Some(total_output),
				rounds: round as u32,
				calls: total_calls,
			});
		}

		let text = outcome.text.unwrap_or_default();
		let output_preview: String = text.chars().take(300).collect();
		let _ = log::write(
			&app,
			&LogSource::Backend,
			"info",
			&format!(
				"[agent] 第 {round} 轮: 输出长度={}, 含tool_call={}, 预览={}",
				text.chars().count(),
				text.contains("<tool_call"),
				output_preview
			),
		);
		let calls = parser::parse_tool_calls(&text);
		if calls.is_empty() {
			record_assistant(&state, &text, Some(total_input), Some(total_output), hit_rate)?;
			return Ok(AgentRunOutcome {
				ok: true,
				text: Some(text),
				error: None,
				input_tokens: Some(total_input),
				output_tokens: Some(total_output),
				rounds: round as u32,
				calls: total_calls,
			});
		}

		total_calls += calls.len() as u32;

		// 执行工具 + 事件推送 + contexts 留痕 (短持锁, 不跨 await)
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		let mut results: Vec<ExecResult> = Vec::new();
		let current_signatures: Vec<String> = calls
			.iter()
			.map(|call| format!("{}::{}", call.name, call.args))
			.collect();
		for (index, call) in calls.iter().enumerate() {
			let execution = match ToolService::global().execute(&conn, &call.name, call.args.clone()) {
				Ok(value) => ExecResult {
					name: call.name.clone(),
					ok: true,
					output: value.to_string(),
				},
				Err(err) => ExecResult {
					name: call.name.clone(),
					ok: false,
					output: err,
				},
			};
			let mut execution = execution;
			if !execution.ok && previous_calls.contains(&current_signatures[index]) {
				execution.output = format!(
					"{}\n[注意: 该参数组合上一次已失败, 请勿重复同样的调用; 检查参数后重试, 或直接告知用户失败原因]",
					execution.output
				);
			}
			results.push(execution.clone());
			let _ = app.emit(
				TOOL_EVENT,
				json!({
					"requestId": request_id,
					"name": execution.name,
					"ok": execution.ok,
					"output": truncate(&execution.output, 200),
				}),
			);
			if !execution.ok {
				let _ = log::write(
					&app,
					&LogSource::Backend,
					"error",
					&format!("工具调用失败 {}: {}\n参数: {}", execution.name, execution.output, call.args),
				);
			}
		}
		previous_calls.extend(current_signatures);
		let results_text = format_results(&results);
		messages.push(LlmMessage {
			role: "assistant".to_string(),
			content: text.clone(),
		});
		messages.push(LlmMessage {
			role: "user".to_string(),
			content: results_text.clone(),
		});

		insert_context(
			&conn,
			"tool",
			"assistant",
			&text,
			outcome.output_tokens.unwrap_or_else(|| estimate_tokens(&text)),
			outcome.input_tokens,
			outcome.output_tokens,
			None,
		)
		.map_err(|e| format!("记录工具上下文失败: {e}"))?;
		insert_context(&conn, "tool", "user", &results_text, estimate_tokens(&results_text), None, None, None)
			.map_err(|e| format!("记录工具上下文失败: {e}"))?;
		drop(conn);

		// 只保留最近 MAX_TOOL_PAIRS 轮往返, 丢弃更早的, 控制上下文体积
		let limit = base_len + MAX_TOOL_PAIRS * 2;
		if messages.len() > limit {
			messages.drain(base_len..messages.len() - limit);
		}
	}

	let stop_text = format!("工具调用轮数已达上限 ({MAX_ROUNDS} 轮), 已停止。你可以把请求拆小一点再试一次。");
	record_assistant(&state, &stop_text, Some(total_input), Some(total_output), hit_rate)?;
	Ok(AgentRunOutcome {
		ok: true,
		text: Some(stop_text),
		error: None,
		input_tokens: Some(total_input),
		output_tokens: Some(total_output),
		rounds: MAX_ROUNDS as u32,
		calls: total_calls,
	})
}
