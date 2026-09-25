//! LLM 适配器命令模块(后端实现层)
//! - [`openai_chat`] OpenAI Chat Completions API (旧版 / 兼容网关)
//! - [`openai_responses`] OpenAI Responses API
//! - [`anthropic_messages`] Anthropic Messages API
//! - [`google_genai`] Google GenAI (Gemini)

pub mod anthropic_messages;
pub mod google_genai;
pub mod openai_chat;
pub mod openai_responses;

use std::time::Duration;

use rusqlite::Connection;
use tauri::Emitter;

use futures_util::StreamExt;

use crate::config::{self, ConfigValue};
use crate::db;
use crate::secret;

/// 流式事件名: 增量文本
pub const STREAM_EVENT_DELTA: &str = "llm-stream-delta";
/// 流式事件名: 结束 (含完整结果/错误)
pub const STREAM_EVENT_END: &str = "llm-stream-end";

/// 统一 LLM 生成请求 (跨平台通用入参, 平台专属字段由各命令按需使用)
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmGenerateArgs {
    /// 对话历史 (含 system / user / assistant 角色)
    pub messages: Vec<LlmMessage>,
    /// 手动指定模型名 (可选, 缺省用配置)
    #[serde(default)]
    pub model: Option<String>,
    /// 温度 (可选, 缺省用各平台默认值)
    #[serde(default)]
    pub temperature: Option<f64>,
    /// 最大输出 token 数 (可选, 缺省为平台默认)
    #[serde(default)]
    pub max_tokens: Option<u64>,
    /// 本次请求唯一标识 (前端生成, 用于匹配流式事件)
    #[serde(default)]
    pub request_id: Option<String>,
}

/// 统一对话消息
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

/// 统一生成结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmGenerateOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl LlmGenerateOutcome {
    pub fn ok(text: String, input_tokens: Option<u64>, output_tokens: Option<u64>) -> Self {
        Self {
            ok: true,
            text: Some(text),
            input_tokens,
            output_tokens,
            error: None,
            error_code: None,
        }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self::err_with(None, error)
    }

    /// 带结构化错误码的失败结果
    pub fn err_with(code: Option<&str>, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            text: None,
            input_tokens: None,
            output_tokens: None,
            error: Some(error.into()),
            error_code: code.map(|s| s.to_string()),
        }
    }
}

/// 统一连接测试结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTestOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

impl LlmTestOutcome {
    pub fn ok(status: u16) -> Self {
        Self {
            ok: true,
            status: Some(status),
            error: None,
            error_code: None,
        }
    }

    pub fn client_err(error: impl Into<String>) -> Self {
        Self::client_err_with(None, error)
    }

    /// 带结构化错误码的客户端失败 (网络 / 校验)
    pub fn client_err_with(code: Option<&str>, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            status: None,
            error: Some(error.into()),
            error_code: code.map(|s| s.to_string()),
        }
    }

    pub fn http_err(status: u16) -> Self {
        Self::http_err_with(status, format!("HTTP {status}"))
    }

    pub fn http_err_with(status: u16, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            status: Some(status),
            error: Some(error.into()),
            error_code: Some("http_error".to_string()),
        }
    }
}

/// 拼接 OpenAI 兼容端点，兼容用户把 base URL 配置为 `.../v1`。
pub(crate) fn build_openai_url(base: &str, endpoint: &str) -> String {
    let base = base.trim_end_matches('/');
    let base = base.strip_suffix("/v1").unwrap_or(base);
    format!("{base}/v1/{}", endpoint.trim_start_matches('/'))
}

/// GPT-5 与 o 系列推理模型不接受旧式采样/输出参数组合。
pub(crate) fn is_openai_reasoning_model(model: &str) -> bool {
    let model = model
        .trim()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    model.starts_with("gpt-5")
        || model
            .strip_prefix('o')
            .and_then(|suffix| suffix.chars().next())
            .is_some_and(|c| c.is_ascii_digit())
}

/// 按 UTF-8 字符边界截断，避免中文或 emoji 被切在多字节编码中间。
pub(crate) fn truncate_utf8(mut text: String, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

/// 从常见 JSON 错误响应中提取可展示的详情。
pub(crate) fn error_detail(body: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let detail = parsed
        .as_ref()
        .and_then(|json| {
            json.pointer("/error/message")
                .or_else(|| json.pointer("/response/error/message"))
                .or_else(|| json.get("message"))
        })
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| body.trim());
    let detail = if detail.is_empty() {
        "响应体为空"
    } else {
        detail
    };
    truncate_utf8(detail.to_string(), 240)
}

/// OpenAI Responses/兼容流中的应用层错误（HTTP 状态仍可能是 200）。
pub(crate) fn extract_openai_stream_error(json: &serde_json::Value) -> Option<String> {
    let event_type = json.get("type").and_then(|value| value.as_str());
    let has_error = json.get("error").is_some_and(|error| !error.is_null());
    if !matches!(event_type, Some("response.failed" | "error")) && !has_error {
        return None;
    }
    let message = json
        .pointer("/response/error/message")
        .or_else(|| json.pointer("/error/message"))
        .or_else(|| json.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or("模型流式响应失败");
    Some(message.to_string())
}

/// 从数据库读取指定配置项的字符串值 (缺失返回 None)
pub(crate) fn read_db_string(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    match config::get(conn, key).map_err(|e| e.to_string())? {
        Some(ConfigValue::String(value)) => Ok(Some(value)),
        Some(ConfigValue::Integer(value)) => Ok(Some(value.to_string())),
        Some(ConfigValue::Boolean(value)) => Ok(Some(value.to_string())),
        Some(ConfigValue::Json(value)) => Ok(Some(value.to_string())),
        None => Ok(None),
    }
}

/// 读取配置项, 缺失时回退默认值
fn read_db_string_or(conn: &Connection, key: &str, fallback: &str) -> Result<String, String> {
    Ok(read_db_string(conn, key)?.unwrap_or_else(|| fallback.to_string()))
}

/// 为当前操作打开独立 DB 连接
pub fn db_conn(state: &tauri::State<'_, db::Db>) -> Result<Connection, String> {
    state.0.lock().map_err(|e| e.to_string())
}

/// 解密存储在配置库中的 API Key (空串原样返回)
pub fn decrypt_api_key(app: &tauri::AppHandle, encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    secret::decrypt_str(app, encoded)
}

/// SSE 流式读取骨架: 发送 POST 请求, 逐行解析 `data:` 负载,
/// 对每个 data 调用 `extract` 提取文本增量并 `emit` 到前端; 累计完整文本.
/// `collect_usage` 提取 usage token，`extract_error` 检测流内错误，
/// `is_complete` 判断各协议的正常完成事件。
/// 结束时统一 `emit` `STREAM_EVENT_END`.
///
/// 返回 `(status, 完整文本, 输入token, 输出token)`:
/// - 非 2xx 时第二个元素为响应原文 (用于错误展示), 不会 emit 增量.
/// - 2xx 且正常完成时第二个元素为拼接的完整文本, 后两元素为流式过程中收集到的 usage.
/// - 流内错误、读取中断或未见完成标记的 EOF 均返回 `Err`.
pub async fn stream_generate(
    app: &tauri::AppHandle,
    request_id: &str,
    url: String,
    headers: Vec<(String, String)>,
    body: serde_json::Value,
    extract: fn(&serde_json::Value) -> Option<String>,
    collect_usage: fn(&serde_json::Value) -> (Option<u64>, Option<u64>),
    extract_error: fn(&serde_json::Value) -> Option<String>,
    is_complete: fn(&serde_json::Value) -> bool,
) -> Result<(u16, String, Option<u64>, Option<u64>), String> {
    // 结束事件统一收尾
    let finish = |app: &tauri::AppHandle, request_id: &str, ok: bool, error: Option<String>| {
        let _ = app.emit(
            STREAM_EVENT_END,
            serde_json::json!({
                "requestId": request_id,
                "ok": ok,
                "error": error,
            }),
        );
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let error = format!("创建 HTTP 客户端失败: {error}");
            finish(app, request_id, false, Some(error.clone()));
            return Err(error);
        }
    };
    let mut req = client.post(&url);
    for (k, v) in headers {
        req = req.header(&k, &v);
    }
    let resp = match req.json(&body).send().await {
        Ok(r) => r,
        Err(e) => {
            finish(app, request_id, false, Some(format!("无法连接 {url}: {e}")));
            return Err(format!("无法连接 {url}: {e}"));
        }
    };
    let status = resp.status().as_u16();
    if status < 200 || status >= 300 {
        let text = match resp.text().await {
            Ok(text) => text,
            Err(error) => {
                let error = format!("读取 {url} 错误响应体失败: {error}");
                finish(app, request_id, false, Some(error.clone()));
                return Err(error);
            }
        };
        finish(app, request_id, false, Some(format!("HTTP {status}")));
        return Ok((status, text, None, None));
    }

    let mut full = String::new();
    let mut usage_input: Option<u64> = None;
    let mut usage_output: Option<u64> = None;
    let mut sse_buf: Vec<u8> = Vec::new();
    let mut saw_completion = false;
    let mut bytes = resp.bytes_stream();
    // 逐块累积并逐行解析
    while let Some(chunk) = bytes.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                finish(app, request_id, false, Some(format!("流读取中断: {e}")));
                return Err(format!("流读取失败: {e}"));
            }
        };
        sse_buf.extend_from_slice(&chunk);
        loop {
            let Some(pos) = sse_buf.iter().position(|&b| b == b'\n') else {
                break;
            };
            let line: Vec<u8> = sse_buf.drain(0..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                // OpenAI Responses 流结束标记
                if data == "[DONE]" {
                    finish(app, request_id, true, None);
                    return Ok((status, full, usage_input, usage_output));
                }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(error) = extract_error(&json) {
                        finish(app, request_id, false, Some(error.clone()));
                        return Err(error);
                    }
                    // 累积 usage: 不同事件的 input / output 各自取非 None
                    let (input, output) = collect_usage(&json);
                    if input.is_some() {
                        usage_input = input;
                    }
                    if output.is_some() {
                        usage_output = output;
                    }
                    if let Some(delta) = extract(&json) {
                        if !delta.is_empty() {
                            full.push_str(&delta);
                            let _ = app.emit(
                                STREAM_EVENT_DELTA,
                                serde_json::json!({ "requestId": request_id, "delta": delta }),
                            );
                        }
                    }
                    if is_complete(&json) {
                        saw_completion = true;
                    }
                }
            }
        }
    }
    if saw_completion {
        finish(app, request_id, true, None);
        Ok((status, full, usage_input, usage_output))
    } else {
        let error = "流在完成事件前意外结束".to_string();
        finish(app, request_id, false, Some(error.clone()));
        Err(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn openai_url_does_not_duplicate_v1() {
        assert_eq!(
            build_openai_url("https://api.example.com/v1/", "responses"),
            "https://api.example.com/v1/responses"
        );
        assert_eq!(
            build_openai_url("https://api.example.com", "chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn reasoning_model_detection_avoids_gpt_4o_false_positive() {
        assert!(is_openai_reasoning_model("gpt-5-mini"));
        assert!(is_openai_reasoning_model("openai/o3-mini"));
        assert!(!is_openai_reasoning_model("gpt-4o"));
        assert!(!is_openai_reasoning_model("omni-moderation-latest"));
    }

    #[test]
    fn utf8_truncation_stays_on_character_boundary() {
        assert_eq!(truncate_utf8("中文🙂error".to_string(), 5), "中");
        assert_eq!(truncate_utf8("中文🙂error".to_string(), 6), "中文");
        assert_eq!(truncate_utf8("中文🙂error".to_string(), 10), "中文🙂");
    }

    #[test]
    fn extracts_openai_stream_failures() {
        let failed = json!({
            "type": "response.failed",
            "response": {"error": {"message": "推理失败"}}
        });
        assert_eq!(extract_openai_stream_error(&failed).as_deref(), Some("推理失败"));
        assert_eq!(extract_openai_stream_error(&json!({"type": "response.completed"})), None);
    }
}
