//! LLM 适配器命令模块(后端实现层)
//! - [`openai_responses`] OpenAI Responses API
//! - [`anthropic_messages`] Anthropic Messages API
//! - [`google_genai`] Google GenAI (Gemini)

pub mod anthropic_messages;
pub mod google_genai;
pub mod openai_responses;

use rusqlite::Connection;

use crate::config::{self, ConfigValue};
use crate::db;
use crate::secret;

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
        Self {
            ok: false,
            status: Some(status),
            error: Some(format!("HTTP {status}")),
            error_code: Some("http_error".to_string()),
        }
    }
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

/// 从应用拿唯一 DB 连接的锁 (供各命令复用)
pub fn db_conn<'a>(
    state: &'a tauri::State<'_, db::Db>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|e| e.to_string())
}

/// 解密存储在配置库中的 API Key (空串原样返回)
pub fn decrypt_api_key(app: &tauri::AppHandle, encoded: &str) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    secret::decrypt_str(app, encoded)
}
