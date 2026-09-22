//! OpenAI Chat Completions API 适配器 (旧版 / 兼容网关)
//! 协议: https://platform.openai.com/docs/api-reference/chat
//! 端点: POST {base}/v1/chat/completions, 鉴权: Authorization: Bearer <apiKey>
//! 适用: 只实现旧版 chat/completions 的服务商与本地网关 (Ollama / LM Studio / one-api 等).

use reqwest::Client;
use std::time::Duration;

use crate::db;
use crate::log::{self, LogSource};

use super::{
	build_openai_url, db_conn, decrypt_api_key, error_detail, extract_openai_stream_error,
	is_openai_reasoning_model, read_db_string_or, stream_generate, truncate_utf8,
	LlmGenerateArgs, LlmGenerateOutcome, LlmTestOutcome,
};

/// 配置键前缀 (与前端 llm_openaichat.ts 保持一致)
const PREFIX: &str = "llm_openai_chat";

/// 读取并解密 OpenAI Chat 配置
struct Config {
	base_url: String,
	api_key: String,
	model: String,
}

/// 归一化服务地址 (默认自动补全 https://)
fn normalize_base_url(raw: &str, fallback: &str) -> String {
	let trimmed = raw.trim();
	if trimmed.is_empty() {
		return fallback.to_string();
	}
	if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
		return trimmed.to_string();
	}
	format!("https://{trimmed}")
}

/// 拼接 {base}/v1/chat/completions
fn build_chat_url(base: &str) -> String {
	build_openai_url(base, "chat/completions")
}

/// 拼接 {base}/v1/models
fn build_models_url(base: &str) -> String {
	build_openai_url(base, "models")
}

/// 从数据库读取配置
fn load_config(state: &tauri::State<'_, db::Db>, app: &tauri::AppHandle) -> Result<Config, String> {
	let conn = db_conn(state)?;
	let default_base = "https://api.openai.com";
	let base_url = normalize_base_url(
		&read_db_string_or(&conn, &format!("{PREFIX}_base_url"), default_base)?,
		default_base,
	);
	let api_key_enc = read_db_string_or(&conn, &format!("{PREFIX}_api_key"), "")?;
	let model = read_db_string_or(&conn, &format!("{PREFIX}_model"), "")?;
	let api_key = decrypt_api_key(app, &api_key_enc)?;
	Ok(Config {
		base_url,
		api_key,
		model,
	})
}

/// 构造一次生成请求体 (Chat Completions 格式)
fn build_body(cfg: &Config, args: &LlmGenerateArgs) -> serde_json::Value {
	use serde_json::json;
	let model = args.model.clone().unwrap_or_else(|| cfg.model.clone());
	let messages: Vec<serde_json::Value> = args
		.messages
		.iter()
		.map(|m| json!({ "role": m.role, "content": m.content }))
		.collect();
	let mut body = json!({
		"model": model,
		"messages": messages,
		"stream": true,
		// 请求流式末尾附带 usage (多数兼容网关支持; 不支持的会忽略或直接不回 usage)
		"stream_options": { "include_usage": true },
	});
	let reasoning_model = is_openai_reasoning_model(body["model"].as_str().unwrap_or_default());
	if !reasoning_model {
		if let Some(temperature) = args.temperature {
			body["temperature"] = json!(temperature);
		}
	}
	if let Some(max) = args.max_tokens.filter(|n| *n > 0) {
		let key = if reasoning_model {
			"max_completion_tokens"
		} else {
			"max_tokens"
		};
		body[key] = json!(max);
	}
	body
}

/// 构造测试请求体 (非流式，给推理模型预留少量思考预算)
fn build_test_body(cfg: &Config) -> serde_json::Value {
	use serde_json::json;
	let mut body = json!({
		"model": cfg.model,
		"messages": [{"role": "user", "content": "ping"}],
	});
	let key = if is_openai_reasoning_model(&cfg.model) {
		"max_completion_tokens"
	} else {
		"max_tokens"
	};
	body[key] = json!(64);
	body
}

/// 校验配置完整性
fn validate(cfg: &Config) -> Result<(), (&'static str, String)> {
	if cfg.api_key.trim().is_empty() {
		return Err(("missing_api_key", "未填写 API Key".to_string()));
	}
	if cfg.model.trim().is_empty() {
		return Err(("missing_model", "未填写模型名".to_string()));
	}
	Ok(())
}

/// 发送一次 POST JSON 请求, 返回 (status, body)
async fn post_json(
	url: String,
	headers: Vec<(String, String)>,
	body: serde_json::Value,
) -> Result<(u16, String), String> {
	let client = Client::builder()
		.timeout(Duration::from_secs(60))
		.build()
		.map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
	let mut req = client.post(&url);
	for (k, v) in headers {
		req = req.header(&k, &v);
	}
	let resp = req
		.json(&body)
		.send()
		.await
		.map_err(|e| format!("无法连接 {url}: {e}"))?;
	let status = resp.status().as_u16();
	let text = resp.text().await.unwrap_or_default();
	Ok((status, text))
}

/// 发送一次 GET JSON 请求, 返回 (status, body)
async fn get_json(
	url: String,
	headers: Vec<(String, String)>,
	timeout: Duration,
) -> Result<(u16, serde_json::Value), String> {
	let client = Client::builder()
		.timeout(timeout)
		.build()
		.map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
	let mut req = client.get(&url);
	for (k, v) in headers {
		req = req.header(&k, &v);
	}
	let resp = req
		.send()
		.await
		.map_err(|e| format!("无法连接 {url}: {e}"))?;
	let status = resp.status().as_u16();
	let parsed = resp
		.json::<serde_json::Value>()
		.await
		.unwrap_or(serde_json::Value::Null);
	Ok((status, parsed))
}

/// 构造 OpenAI 鉴权头
fn auth_headers(cfg: &Config) -> Vec<(String, String)> {
	vec![
		("Content-Type".to_string(), "application/json".to_string()),
		("Authorization".to_string(), format!("Bearer {}", cfg.api_key.trim())),
	]
}

/// 从 Chat Completions 流式事件中提取 usage (两种字段命名都兼容)
fn extract_usage(json: &serde_json::Value) -> (Option<u64>, Option<u64>) {
	let Some(usage) = json.get("usage") else {
		return (None, None);
	};
	let input = usage
		.get("prompt_tokens")
		.and_then(|v| v.as_u64())
		.or_else(|| usage.get("input_tokens").and_then(|v| v.as_u64()));
	let output = usage
		.get("completion_tokens")
		.and_then(|v| v.as_u64())
		.or_else(|| usage.get("output_tokens").and_then(|v| v.as_u64()));
	(input, output)
}

/// 生成: invoke("llm_openai_chat_generate", { messages, model?, temperature?, maxTokens?, requestId? })
/// 使用 SSE 流式返回, 增量通过 `llm-stream-delta` 事件推送前端.
#[tauri::command]
pub async fn llm_openai_chat_generate(
	app: tauri::AppHandle,
	state: tauri::State<'_, db::Db>,
	args: LlmGenerateArgs,
) -> Result<LlmGenerateOutcome, String> {
	let cfg = load_config(&state, &app).map_err(|e| {
		let _ = log::write(
			&app,
			&LogSource::Backend,
			"error",
			&format!("OpenAI Chat generate 加载配置失败: {e}"),
		);
		e
	})?;
	if let Err((code, msg)) = validate(&cfg) {
		return Ok(LlmGenerateOutcome::err_with(Some(code), msg));
	}
	let body = build_body(&cfg, &args);
	let request_id = args.request_id.unwrap_or_default();
	let (status, resp, input_tokens, output_tokens) = match stream_generate(
		&app,
		&request_id,
		build_chat_url(&cfg.base_url),
		auth_headers(&cfg),
		body,
		|json| {
			// Chat Completions 流式文本增量: choices[0].delta.content
			json.get("choices")
				.and_then(|choices| choices.as_array())
				.and_then(|choices| choices.first())
				.and_then(|choice| choice.get("delta"))
				.and_then(|delta| delta.get("content"))
				.and_then(|content| content.as_str())
				.map(|s| s.to_string())
		},
		|json| extract_usage(json),
		extract_openai_stream_error,
		|json| {
			json.get("choices")
				.and_then(|choices| choices.as_array())
				.and_then(|choices| choices.first())
				.and_then(|choice| choice.get("finish_reason"))
				.is_some_and(|reason| !reason.is_null())
		},
	)
	.await
	{
		Ok(v) => v,
		Err(e) => {
			let _ = log::write(
				&app,
				&LogSource::Backend,
				"error",
				&format!("OpenAI Chat generate 流式请求失败: {e}"),
			);
			return Ok(LlmGenerateOutcome::err_with(Some("network_error"), e));
		}
	};
	if status < 200 || status >= 300 {
		let reason = truncate(resp);
		let _ = log::write(
			&app,
			&LogSource::Backend,
			"error",
			&format!("OpenAI Chat generate 失败 {status}: {reason}"),
		);
		return Ok(LlmGenerateOutcome::err_with(
			Some("http_error"),
			format!("OpenAI Chat 接口返回 {status}: {reason}"),
		));
	}
	let _ = log::write(
		&app,
		&LogSource::Backend,
		"info",
		"OpenAI Chat generate 流式完成",
	);
	Ok(LlmGenerateOutcome::ok(resp, input_tokens, output_tokens))
}

/// 连接测试: invoke("llm_openai_chat_test_connection")
#[tauri::command]
pub async fn llm_openai_chat_test_connection(
	app: tauri::AppHandle,
	state: tauri::State<'_, db::Db>,
) -> Result<LlmTestOutcome, String> {
	let cfg = load_config(&state, &app).map_err(|e| {
		let _ = log::write(
			&app,
			&LogSource::Backend,
			"error",
			&format!("OpenAI Chat 连接测试加载配置失败: {e}"),
		);
		e
	})?;
	if let Err((code, msg)) = validate(&cfg) {
		return Ok(LlmTestOutcome::client_err_with(Some(code), msg));
	}
	let body = build_test_body(&cfg);
	match post_json(build_chat_url(&cfg.base_url), auth_headers(&cfg), body).await {
		Ok((status, response)) => {
			if (200..300).contains(&status) {
				Ok(LlmTestOutcome::ok(status))
			} else {
				let detail = error_detail(&response);
				Ok(LlmTestOutcome::http_err_with(
					status,
					format!("HTTP {status}: {detail}"),
				))
			}
		}
		Err(e) => {
			let _ = log::write(
				&app,
				&LogSource::Backend,
				"error",
				&format!("OpenAI Chat 连接测试网络请求失败: {e}"),
			);
			Ok(LlmTestOutcome::client_err_with(Some("network_error"), e))
		}
	}
}

/// 模型列表: invoke("llm_openai_chat_list_models")
#[tauri::command]
pub async fn llm_openai_chat_list_models(
	app: tauri::AppHandle,
	state: tauri::State<'_, db::Db>,
) -> Result<Vec<String>, String> {
	let cfg = load_config(&state, &app).map_err(|e| {
		let _ = log::write(
			&app,
			&LogSource::Backend,
			"error",
			&format!("OpenAI Chat 模型列表加载配置失败: {e}"),
		);
		e
	})?;
	if cfg.api_key.trim().is_empty() {
		return Ok(Vec::new());
	}
	let headers = vec![(
		"Authorization".to_string(),
		format!("Bearer {}", cfg.api_key.trim()),
	)];
	match get_json(
		build_models_url(&cfg.base_url),
		headers,
		Duration::from_secs(20),
	)
	.await
	{
		Err(e) => {
			let _ = log::write(
				&app,
				&LogSource::Backend,
				"error",
				&format!("OpenAI Chat 模型列表网络请求失败: {e}"),
			);
			Ok(Vec::new())
		}
		Ok((status, resp)) if (200..300).contains(&status) => {
			let ids = resp
				.get("data")
				.and_then(|v| v.as_array())
				.map(|arr| {
					arr.iter()
						.filter_map(|m| {
							m.get("id")
								.and_then(|v| v.as_str())
								.map(|s| s.to_string())
						})
						.filter(|s| !s.is_empty())
						.collect::<Vec<_>>()
				})
				.unwrap_or_default();
			let mut ids = ids;
			ids.sort();
			Ok(ids)
		}
		_ => Ok(Vec::new()),
	}
}

/// 截断错误/响应文本便于日志展示
fn truncate(s: String) -> String {
	truncate_utf8(s, 240)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn config(model: &str) -> Config {
		Config {
			base_url: String::new(),
			api_key: String::new(),
			model: model.to_string(),
		}
	}

	fn args(model: &str) -> LlmGenerateArgs {
		LlmGenerateArgs {
			messages: Vec::new(),
			model: Some(model.to_string()),
			temperature: Some(0.5),
			max_tokens: Some(128),
			request_id: None,
		}
	}

	#[test]
	fn reasoning_models_use_completion_token_limit_without_temperature() {
		let body = build_body(&config("unused"), &args("o3-mini"));
		assert!(body.get("temperature").is_none());
		assert!(body.get("max_tokens").is_none());
		assert_eq!(body["max_completion_tokens"], 128);
	}

	#[test]
	fn regular_models_keep_legacy_chat_parameters() {
		let body = build_body(&config("unused"), &args("gpt-4o"));
		assert_eq!(body["temperature"], 0.5);
		assert_eq!(body["max_tokens"], 128);
		assert!(body.get("max_completion_tokens").is_none());
	}

	#[test]
	fn missing_usage_returns_empty_counts() {
		assert_eq!(extract_usage(&serde_json::json!({"choices": []})), (None, None));
	}
}
