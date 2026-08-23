//! OpenAI Responses API 适配器
//! 协议: https://platform.openai.com/docs/api-reference/responses
//! 端点: POST {base}/v1/responses, 鉴权: Authorization: Bearer <apiKey>

use reqwest::Client;
use std::time::Duration;

use crate::db;
use crate::log::{self, LogSource};

use super::{db_conn, decrypt_api_key, read_db_string, read_db_string_or, LlmGenerateArgs, LlmGenerateOutcome, LlmTestOutcome};

/// 配置键前缀 (与前端 llm_openai_responses.ts 保持一致)
const PREFIX: &str = "llm_openai_responses";

/// 读取并解密 OpenAI Responses 配置
struct Config {
    base_url: String,
    api_key: String,
    model: String,
    reasoning_effort: String,
}

/// 归一化服务地址 (缺省自动补全 https://)
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

/// 拼接 {base}/v1/responses
fn build_responses_url(base: &str) -> String {
    format!("{}/v1/responses", base.trim_end_matches('/'))
}

/// 拼接 {base}/v1/models
fn build_models_url(base: &str) -> String {
    format!("{}/v1/models", base.trim_end_matches('/'))
}

/// 从数据库读取配置
fn load_config(
    state: &tauri::State<'_, db::Db>,
    app: &tauri::AppHandle,
) -> Result<Config, String> {
    let conn = db_conn(state)?;
    let default_base = "https://api.openai.com";
    let base_url = normalize_base_url(
        &read_db_string_or(&conn, &format!("{PREFIX}_base_url"), default_base)?,
        default_base,
    );
    let api_key_enc = read_db_string_or(&conn, &format!("{PREFIX}_api_key"), "")?;
    let model = read_db_string_or(&conn, &format!("{PREFIX}_model"), "")?;
    let reasoning_effort = read_db_string(&conn, &format!("{PREFIX}_reasoning_effort"))?.unwrap_or_default();
    let api_key = decrypt_api_key(app, &api_key_enc)?;
    Ok(Config {
        base_url,
        api_key,
        model,
        reasoning_effort,
    })
}

/// 构造一次生成请求体 (OpenAI Responses 格式)
fn build_body(cfg: &Config, args: &LlmGenerateArgs) -> serde_json::Value {
    use serde_json::json;
    let model = args.model.clone().unwrap_or_else(|| cfg.model.clone());
    let input: Vec<serde_json::Value> = args
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = json!({
        "model": model,
        "input": input,
        "temperature": args.temperature.unwrap_or(1.0),
    });
    if let Some(max) = args.max_tokens.filter(|n| *n > 0) {
        body["max_output_tokens"] = json!(max);
    }
    // 空字符串表示不携带 reasoning 字段
    if !cfg.reasoning_effort.is_empty() {
        body["reasoning"] = json!({ "effort": cfg.reasoning_effort });
    }
    body
}

/// 构造测试请求体
fn build_test_body(cfg: &Config) -> serde_json::Value {
    use serde_json::json;
    let mut body = json!({
        "model": cfg.model,
        "input": [{"role": "user", "content": "ping"}],
        "max_output_tokens": 1,
    });
    if !cfg.reasoning_effort.is_empty() {
        body["reasoning"] = json!({ "effort": cfg.reasoning_effort });
    }
    body
}

/// 从 Responses 响应中拼接文本 (output[] 里 type=message 段的 text)
fn extract_text(body: &serde_json::Value) -> String {
    let Some(output) = body.get("output").and_then(|v| v.as_array()) else {
        return String::new();
    };
    let mut text = String::new();
    for part in output {
        if part.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let Some(content) = part.get("content").and_then(|v| v.as_array()) else {
            continue;
        };
        for c in content {
            if let Some(t) = c.get("text").and_then(|v| v.as_str()) {
                text.push_str(t);
            }
        }
    }
    text
}

/// 提取 usage 中的 token 计数
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

/// 发送一次 GET JSON 请求, 返回 (status, body)
async fn get_json(url: String, headers: Vec<(String, String)>, timeout: Duration) -> Result<(u16, serde_json::Value), String> {
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

/// 生成: invoke("llm_openai_generate", { messages, model?, temperature?, maxTokens? })
#[tauri::command]
pub async fn llm_openai_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
    args: LlmGenerateArgs,
) -> Result<LlmGenerateOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmGenerateOutcome::err_with(Some(code), msg));
    }
    let body = build_body(&cfg, &args);
    let (status, resp) = match post_json(build_responses_url(&cfg.base_url), auth_headers(&cfg), body).await {
        Ok(v) => v,
        Err(e) => return Ok(LlmGenerateOutcome::err_with(Some("network_error"), e)),
    };
    if status < 200 || status >= 300 {
        let reason = extract_error(&resp);
        let _ = log::write(&app, &LogSource::Backend, "error", &format!("OpenAI generate 失败 {status}: {reason}"));
        return Ok(LlmGenerateOutcome::err_with(Some("http_error"), format!("OpenAI 接口返回 {status}: {reason}")));
    }
    let text = extract_text(&resp);
    let (input, output) = usage_tokens(&resp);
    let _ = log::write(&app, &LogSource::Backend, "info", "OpenAI generate 完成");
    Ok(LlmGenerateOutcome::ok(text, input, output))
}

/// 连接测试: invoke("llm_openai_test_connection")
#[tauri::command]
pub async fn llm_openai_test_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<LlmTestOutcome, String> {
    let cfg = load_config(&state, &app)?;
    if let Err((code, msg)) = validate(&cfg) {
        return Ok(LlmTestOutcome::client_err_with(Some(code), msg));
    }
    let body = build_test_body(&cfg);
    match post_json(build_responses_url(&cfg.base_url), auth_headers(&cfg), body).await {
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

/// 模型列表: invoke("llm_openai_list_models")
#[tauri::command]
pub async fn llm_openai_list_models(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<Vec<String>, String> {
    let cfg = load_config(&state, &app)?;
    if cfg.api_key.trim().is_empty() {
        return Ok(Vec::new());
    }
    let headers = vec![("Authorization".to_string(), format!("Bearer {}", cfg.api_key.trim()))];
    match get_json(
        build_models_url(&cfg.base_url),
        headers,
        Duration::from_secs(20),
    )
    .await
    {
        Ok((status, resp)) if (200..300).contains(&status) => {
            let ids = resp
                .get("data")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
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

/// 从错误响应体提取人类可读信息
fn extract_error(body: &serde_json::Value) -> String {
    let mut chunk = body.to_string();
    if chunk.len() > 240 {
        chunk.truncate(240);
    }
    chunk
}
