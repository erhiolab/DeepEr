//! GPT-SoVITS 适配器
//! 服务端 API 版本: V2, 接口: POST {base}/tts(JSON body)

use reqwest::Client;
use serde_json::Value;
use std::path::PathBuf;

use crate::db;
use crate::log::{self, LogSource};
use crate::resource;

use super::{db_conn, read_db_string, read_db_string_or};

/// 配置键前缀 (与前端 tts_gptsovits.ts 保持一致)
const PREFIX: &str = "tts_gpt_sovits";
/// 情绪(参考音频)列表配置键
const KEY_EMOTIONS: &str = "tts_gpt_sovits_emotions";

/// GPT-SoVITS 合成配置
struct Config {
    base_url: String,
    text_lang: String,
    top_k: i64,
    top_p: f64,
    temperature: f64,
    text_split_method: String,
    batch_size: i64,
    emotions: Vec<Emotion>,
}

/// 一条参考音频 (情绪)
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Emotion {
    name: String,
    #[serde(default)]
    audio_path: String,
    #[serde(default)]
    prompt_text: String,
    #[serde(default)]
    prompt_lang: String,
}

/// 统一合成请求入参
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSynthesizeArgs {
    /// 要合成的文本 (必填)
    pub text: String,
    /// 音色/情绪名 (可选, 缺省用第一条)
    #[serde(default)]
    pub voice: Option<String>,
}

/// 合成统一结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSynthesizeOutcome {
    pub ok: bool,
    /// asset 协议相对路径, 如 `tts/tts_<timestamp>.wav`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_path: Option<String>,
    /// 文件名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    /// 文件大小 (bytes)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// 人类可读错误
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 结构化错误码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

/// 构造失败结果 (供各失败分支复用)
fn fail_outcome(code: &str, error: String) -> TtsSynthesizeOutcome {
    TtsSynthesizeOutcome {
        ok: false,
        asset_path: None,
        file_name: None,
        size: None,
        error: Some(error),
        error_code: Some(code.to_string()),
    }
}

/// 归一化服务地址
fn normalize_base_url(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    format!("http://{trimmed}")
}

/// 拼接 {base}/tts
fn build_tts_url(base: &str) -> String {
    format!("{}/tts", base.trim_end_matches('/'))
}

fn to_number(raw: Option<String>, fallback: i64) -> i64 {
    match raw {
        Some(s) => s.trim().parse::<i64>().unwrap_or(fallback),
        None => fallback,
    }
}

/// 解析 emotions JSON
fn parse_emotions(raw: String) -> Vec<Emotion> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    match serde_json::from_str::<Vec<Emotion>>(&raw) {
        Ok(list) => list
            .into_iter()
            .filter(|e| !e.name.trim().is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn load_config(
    state: &tauri::State<'_, db::Db>,
) -> Result<Config, String> {
    let conn = db_conn(state)?;
    let default_base = "http://127.0.0.1:9880";
    let base_url = normalize_base_url(
        &read_db_string_or(&conn, &format!("{PREFIX}_base_url"), default_base)?,
        default_base,
    );
    let text_lang = read_db_string_or(&conn, &format!("{PREFIX}_text_lang"), "zh")?;
    let top_k = to_number(read_db_string(&conn, &format!("{PREFIX}_top_k"))?, 15);
    let top_p = read_db_string(&conn, &format!("{PREFIX}_top_p"))?
        .and_then(|s| s.trim().parse::<f64>().ok())
        .unwrap_or(1.0);
    let temperature = read_db_string(&conn, &format!("{PREFIX}_temperature"))?
        .and_then(|s| s.trim().parse::<f64>().ok())
        .unwrap_or(1.0);
    let text_split_method = read_db_string_or(&conn, &format!("{PREFIX}_text_split_method"), "cut5")?;
    let batch_size = to_number(read_db_string(&conn, &format!("{PREFIX}_batch_size"))?, 1);
    let emotions_raw = read_db_string_or(&conn, KEY_EMOTIONS, "")?;
    let emotions = parse_emotions(emotions_raw);
    Ok(Config {
        base_url,
        text_lang,
        top_k,
        top_p,
        temperature,
        text_split_method,
        batch_size,
        emotions,
    })
}

/// 按音色名查找参考音频, 未指定时用第一条
fn find_voice<'a>(cfg: &'a Config, voice: &Option<String>) -> Option<&'a Emotion> {
    if let Some(name) = voice {
        if !name.trim().is_empty() {
            return cfg.emotions.iter().find(|e| e.name == name.trim());
        }
    }
    cfg.emotions.first()
}

/// 构造 GPT-SoVITS 合成参数
fn build_params(cfg: &Config, text: &str, entry: &Emotion) -> Value {
    let mut params = serde_json::json!({
        "text": text,
        "text_lang": cfg.text_lang,
        "ref_audio_path": entry.audio_path,
        "prompt_lang": entry.prompt_lang,
        "top_k": cfg.top_k,
        "top_p": cfg.top_p,
        "temperature": cfg.temperature,
        "text_split_method": cfg.text_split_method,
        "batch_size": cfg.batch_size,
        "streaming_mode": false,
    });
    if !entry.prompt_text.is_empty() {
        params["prompt_text"] = Value::String(entry.prompt_text.clone());
    }
    params
}

/// 合成: invoke("tts_gptsovits_synthesize", { text, voice? })
#[tauri::command]
pub async fn tts_gptsovits_synthesize(
    app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
    args: TtsSynthesizeArgs,
) -> Result<TtsSynthesizeOutcome, String> {
    if args.text.trim().is_empty() {
        return Ok(fail_outcome("empty_text", "合成文本不能为空".to_string()));
    }
    let cfg = load_config(&state)?;
    let Some(entry) = find_voice(&cfg, &args.voice) else {
        return Ok(fail_outcome("missing_voice", format!("未找到音色: {}", args.voice.clone().unwrap_or_default())));
    };
    let params = build_params(&cfg, &args.text, entry);
    let url = build_tts_url(&cfg.base_url);

    let response = match Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(client) => match client.post(&url).json(&params).send().await {
            Ok(r) => r,
            Err(e) => {
                return Ok(fail_outcome("network_error", format!("TTS 请求失败: {e}")));
            }
        },
        Err(e) => {
            return Ok(fail_outcome("network_error", format!("创建 HTTP 客户端失败: {e}")));
        }
    };
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("<无法读取错误响应>"));
        let message = extract_error_message(&body);
        return Ok(fail_outcome("http_error", format!("TTS 接口返回 {status}: {message}")));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 TTS 音频流失败: {e}"))?;
    if bytes.is_empty() {
        return Ok(fail_outcome("empty_audio", "TTS 接口返回了空音频".to_string()));
    }

    // 缓存目录: <应用数据目录>/temp/tts
    let cache_dir = resource::temp_dir(&app)?.join("tts");
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("创建 TTS 缓存目录失败: {e}"))?;
    prune_cache(&cache_dir);

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = "wav";
    let file_name = format!("tts_{stamp}.{ext}");
    let file_path = cache_dir.join(&file_name);
    std::fs::write(&file_path, &bytes).map_err(|e| format!("保存 TTS 音频失败: {e}"))?;
    let size = bytes.len() as u64;
    let _ = log::write(
        &app,
        &LogSource::Backend,
        "info",
        &format!("TTS 合成完成: {} bytes -> {}", size, file_path.display()),
    );
    Ok(TtsSynthesizeOutcome {
        ok: true,
        asset_path: Some(format!("tts/{file_name}")),
        file_name: Some(file_name),
        size: Some(size),
        error: None,
        error_code: None,
    })
}

/// 连接测试: invoke("tts_gptsovits_test_connection")
#[tauri::command]
pub async fn tts_gptsovits_test_connection(
    _app: tauri::AppHandle,
    state: tauri::State<'_, db::Db>,
) -> Result<u16, String> {
    let cfg = load_config(&state)?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(&cfg.base_url)
        .send()
        .await
        .map_err(|e| format!("无法连接 {}: {e}", cfg.base_url))?;
    Ok(response.status().as_u16())
}

/// 从错误响应体中提取可供展示的消息
fn extract_error_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        for key in ["detail", "message", "Exception"] {
            if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
                if !text.is_empty() && !is_placeholder_message(text, key) {
                    return text.to_string();
                }
            }
        }
        if body.trim_start().starts_with('{') {
            return body.chars().take(240).collect();
        }
    }
    body.chars().take(240).collect()
}

/// 判断某个错误消息是否是"无信息量的占位文案"
fn is_placeholder_message(text: &str, key: &str) -> bool {
    if key != "message" {
        return false;
    }
    let trimmed = text.trim().to_ascii_lowercase();
    trimmed.is_empty()
        || matches!(
            trimmed.as_str(),
            "tts failed" | "tts 合成失败" | "合成失败" | "failed"
        )
}

/// 清理 temp/tts 目录中超过 2 小时的旧文件
fn prune_cache(dir: &PathBuf) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let threshold = now.saturating_sub(2 * 60 * 60);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let modified = metadata
                        .modified()
                        .map(|d| {
                            d.duration_since(std::time::UNIX_EPOCH)
                                .map(|e| e.as_secs() as i64)
                                .unwrap_or(0)
                        })
                        .unwrap_or(0);
                    if modified < threshold {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_error_message_prefers_detail() {
        let body = r#"{"detail":"ref_audio_path is required"}"#;
        assert_eq!(extract_error_message(body), "ref_audio_path is required");
    }

    #[test]
    fn extract_error_message_falls_back_to_exception() {
        // GPT-SoVITS api_v2.py 合成失败返回 {"message":"tts failed","Exception":<真因>}
        let body = r#"{"message":"tts failed","Exception":"参考音频在3~10秒范围内, 请更换! "}"#;
        assert_eq!(extract_error_message(body), "参考音频在3~10秒范围内, 请更换! ");
    }

    #[test]
    fn parse_emotions_handles_empty() {
        assert!(parse_emotions(String::new()).is_empty());
        assert!(parse_emotions(r#"not-json"#.to_string()).is_empty());
    }

    #[test]
    fn parse_emotions_filters_empty_name() {
        let raw = r#"[{"name":"","audioPath":"a.wav"},{"name":"happy","audioPath":"b.wav"}]"#;
        let list = parse_emotions(raw.to_string());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "happy");
        assert_eq!(list[0].audio_path, "b.wav");
    }
}
