//! Google GenAI (Gemini) 适配器
//! 协议: https://ai.google.dev/api/generate-content
//! 端点: POST {base}/v1beta/models/{model}:generateContent?key={apiKey}
//!       GET  {base}/v1beta/models?key={apiKey}
//! 鉴权: URL query 参数 `key`(亦兼容 Authorization: Bearer)

use reqwest::Client;
use std::time::Duration;

use crate::db;
use crate::log::{self, LogSource};

use super::{db_conn, decrypt_api_key, read_db_string_or, LlmGenerateArgs, LlmGenerateOutcome, LlmTestOutcome};

/// 配置键前缀 (与前端 llm_google_genai.ts 保持一致)
const PREFIX: &str = "llm_google_genai";

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

fn load_config(
    state: &tauri::State<'_, db::Db>,
    app: &tauri::AppHandle,
) -> Result<Config, String> {
    let conn = db_conn(state)?;
    let default_base = "https://generativelanguage.googleapis.com";
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

/// 拼接 {base}/v1beta/models/{model}:generateContent(apiKey 走 query)
fn build_generate_url(cfg: &Config, model: &str) -> String {
    let base = cfg.base_url.trim_end_matches('/');
    let model_encoded = percent_encode(model);
    let key = cfg.api_key.trim();
    let key_q = if key.is_empty() {
        String::new()
    } else {
        format!("?key={}", percent_encode(key))
    };
    format!("{base}/v1beta/models/{model_encoded}:generateContent{key_q}")
}

/// 拼接模型列表地址 {base}/v1beta/models
fn build_models_url(cfg: &Config) -> String {
    let base = cfg.base_url.trim_end_matches('/');
    let key = cfg.api_key.trim();
    let key_q = if key.is_empty() {
        String::new()
    } else {
        format!("?key={}", percent_encode(key))
    };
    format!("{base}/v1beta/models{key_q}")
}

/// URL percent-encode(复用 reqwest 的 QueryPair 方式, 简单实现)
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}

/// 构造生成请求体(system 用 systemInstruction, 其余角色 user/model)
fn build_body(args: &LlmGenerateArgs) -> serde_json::Value {
    use serde_json::json;
    let system = args
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let contents: Vec<serde_json::Value> = args
        .messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            json!({
                "role": if m.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": m.content }],
            })
        })
        .collect();
    let mut body = json!({ "contents": contents });
    if !system.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    body
}

fn build_test_body() -> serde_json::Value {
    use serde_json::json;
    json!({
        "contents": [{ "role": "user", "parts": [{ "text": "ping" }] }],
        "generationConfig": { "maxOutputTokens": 1 },
    })
}

/// 从 generateContent 响应提取文本(candidates[0].content.parts.text)
fn extract_text(body: &serde_json::Value) -> String {
    let Some(candidates) = body.get("candidates").and_then(|v| v.as_array()) else {
        return String::new();
    };
    let Some(cand) = candidates.first() else {
        return String::new();
    };
    let Some(content) = cand.get("content") else {
        return String::new();
    };
    let Some(parts) = content.get("parts").and_then(|v| v.as_array()) else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
        .collect()
}

fn usage_tokens(body: &serde_json::Value) -> (Option<u64>, Option<u64>) {
    match body.get("usageMetadata") {
        Some(u) if u.is_object() => {
            let input = u.get("promptTokenCount").and_then(|v| v.as_u64());
            let output = u.get("candidatesTokenCount").and_then(|v| v.as_u64());
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

/// 生成: invoke("llm_google_generate", { messages, model?, temperature?, maxTokens? })
#[tauri::command]
pub async fn llm_google_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
    args: LlmGenerateArgs,
) -> Result<LlmGenerateOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmGenerateOutcome::err_with(Some(code), msg));
    }
    let model = args.model.clone().unwrap_or_else(|| cfg.model.clone());
    let url = build_generate_url(&cfg, &model);
    let body = build_body(&args);
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let resp = match client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Ok(LlmGenerateOutcome::err_with(Some("network_error"), format!("无法连接 {url}: {e}"))),
    };
    let status = resp.status().as_u16();
    let parsed: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    if status < 200 || status >= 300 {
        let reason = truncate(parsed.to_string());
        let _ = log::write(&app, &LogSource::Backend, "error", &format!("Google generate 失败 {status}: {reason}"));
        return Ok(LlmGenerateOutcome::err_with(Some("http_error"), format!("Google 接口返回 {status}: {reason}")));
    }
    let text = extract_text(&parsed);
    let (input, output) = usage_tokens(&parsed);
    Ok(LlmGenerateOutcome::ok(text, input, output))
}

/// 连接测试: invoke("llm_google_test_connection")
#[tauri::command]
pub async fn llm_google_test_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<LlmTestOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmTestOutcome::client_err_with(Some(code), msg));
    }
    let url = build_generate_url(&cfg, &cfg.model);
    let body = build_test_body();
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    match client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if (200..300).contains(&status) {
                Ok(LlmTestOutcome::ok(status))
            } else {
                Ok(LlmTestOutcome::http_err(status))
            }
        }
        Err(e) => Ok(LlmTestOutcome::client_err_with(Some("network_error"), format!("{e}"))),
    }
}

/// 模型列表: invoke("llm_google_list_models")
#[tauri::command]
pub async fn llm_google_list_models(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<Vec<String>, String> {
    let cfg = load_config(&state, &app)?;
    if cfg.api_key.trim().is_empty() {
        return Ok(Vec::new());
    }
    let url = build_models_url(&cfg);
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            let parsed: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
            let ids = parsed
                .get("models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            m.get("name")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .map(|s| s.strip_prefix("models/").map(|x| x.to_string()).unwrap_or(s))
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

fn truncate(mut s: String) -> String {
    if s.len() > 240 {
        s.truncate(240);
    }
    s
}
