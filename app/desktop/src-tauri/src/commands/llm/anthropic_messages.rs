//! Anthropic Messages API 适配器
//! 协议: https://docs.anthropic.com/en/api/messages
//! 端点: POST {base}/v1/messages
//! 鉴权: x-api-key + anthropic-version: 2023-06-01
//! 说明: Messages 协议 system 是独立顶层字段, 其余消息只有 user / assistant 两种角色.

use reqwest::Client;
use std::time::Duration;

use crate::db;
use crate::log::{self, LogSource};

use super::{db_conn, decrypt_api_key, read_db_string_or, LlmGenerateArgs, LlmGenerateOutcome, LlmTestOutcome};

/// 配置键前缀 (与前端 llm_anthropic_messages.ts 保持一致)
const PREFIX: &str = "llm_anthropic_messages";
/// Anthropic 版本头
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// 读取并解密 Anthropic 配置
struct Config {
    base_url: String,
    api_key: String,
    model: String,
}

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

fn build_messages_url(base: &str) -> String {
    format!("{}/v1/messages", base.trim_end_matches('/'))
}

fn load_config(
    state: &tauri::State<'_, db::Db>,
    app: &tauri::AppHandle,
) -> Result<Config, String> {
    let conn = db_conn(state)?;
    let default_base = "https://api.anthropic.com";
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

/// 构造生成请求体 (system 独立提取, 其余合并为 user/assistant 序列)
fn build_body(cfg: &Config, args: &LlmGenerateArgs) -> serde_json::Value {
    use serde_json::json;
    let model = args.model.clone().unwrap_or_else(|| cfg.model.clone());
    let system = args
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let messages: Vec<serde_json::Value> = args
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "assistant" } else { "user" },
                "content": m.content,
            })
        })
        .collect();
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": args.temperature.unwrap_or(1.0),
    });
    if let Some(max) = args.max_tokens.filter(|n| *n > 0) {
        body["max_tokens"] = json!(max);
    }
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    body
}

fn build_test_body(cfg: &Config) -> serde_json::Value {
    use serde_json::json;
    json!({
        "model": cfg.model,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "ping" }],
    })
}

/// 从 Messages 响应提取文本 (content[] 中 text 段拼接)
fn extract_text(body: &serde_json::Value) -> String {
    let Some(content) = body.get("content").and_then(|v| v.as_array()) else {
        return String::new();
    };
    content
        .iter()
        .filter_map(|part| {
            if part.get("type").and_then(|v| v.as_str()) == Some("text") {
                part.get("text").and_then(|v| v.as_str())
            } else {
                None
            }
        })
        .collect()
}

fn usage_tokens(body: &serde_json::Value) -> (Option<u64>, Option<u64>) {
    match body.get("usage") {
        Some(u) if u.is_object() => {
            let input = u.get("input_tokens").and_then(|v| v.as_u64());
            let output = u.get("output_tokens").and_then(|v| v.as_u64());
            (input, output)
        }
        _ => (None, None),
    }
}

fn validate(cfg: &Config) -> Result<(), (&'static str, String)> {
    if cfg.api_key.trim().is_empty() {
        return Err(("missing_api_key", "未填写 API Key".to_string()));
    }
    if cfg.model.trim().is_empty() {
        return Err(("missing_model", "未填写模型名".to_string()));
    }
    Ok(())
}

fn auth_headers(cfg: &Config) -> Vec<(String, String)> {
    vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("x-api-key".to_string(), cfg.api_key.trim().to_string()),
        ("anthropic-version".to_string(), ANTHROPIC_VERSION.to_string()),
    ]
}

async fn post_json(url: String, headers: Vec<(String, String)>, body: serde_json::Value) -> Result<(u16, serde_json::Value), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
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
    let parsed = resp
        .json::<serde_json::Value>()
        .await
        .unwrap_or(serde_json::Value::Null);
    Ok((status, parsed))
}

/// 生成: invoke("llm_anthropic_generate", { messages, model?, temperature?, maxTokens? })
#[tauri::command]
pub async fn llm_anthropic_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
    args: LlmGenerateArgs,
) -> Result<LlmGenerateOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmGenerateOutcome::err_with(Some(code), msg));
    }
    let body = build_body(&cfg, &args);
    let (status, resp) = match post_json(build_messages_url(&cfg.base_url), auth_headers(&cfg), body).await {
        Ok(v) => v,
        Err(e) => return Ok(LlmGenerateOutcome::err_with(Some("network_error"), e)),
    };
    if status < 200 || status >= 300 {
        let reason = truncate(resp.to_string());
        let _ = log::write(&app, &LogSource::Backend, "error", &format!("Anthropic generate 失败 {status}: {reason}"));
        return Ok(LlmGenerateOutcome::err_with(Some("http_error"), format!("Anthropic 接口返回 {status}: {reason}")));
    }
    let text = extract_text(&resp);
    let (input, output) = usage_tokens(&resp);
    Ok(LlmGenerateOutcome::ok(text, input, output))
}

/// 连接测试: invoke("llm_anthropic_test_connection")
#[tauri::command]
pub async fn llm_anthropic_test_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<LlmTestOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmTestOutcome::client_err_with(Some(code), msg));
    }
    let body = build_test_body(&cfg);
    match post_json(build_messages_url(&cfg.base_url), auth_headers(&cfg), body).await {
        Ok((status, _)) => {
            if (200..300).contains(&status) {
                Ok(LlmTestOutcome::ok(status))
            } else {
                Ok(LlmTestOutcome::http_err(status))
            }
        }
        Err(e) => Ok(LlmTestOutcome::client_err_with(Some("network_error"), e)),
    }
}

fn truncate(mut s: String) -> String {
    if s.len() > 240 {
        s.truncate(240);
    }
    s
}
