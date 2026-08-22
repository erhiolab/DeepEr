//! TTS 通用命令
//!
//! 与具体适配器解耦: 命令只负责「发起 HTTP 请求 + 保存音频产物」,
//! 具体的 URL 与查询参数由前端按当前适配器组装后传入.
//! 这样新增适配器无需修改后端.

use reqwest::Client;
use std::path::PathBuf;

use crate::log;

/// 支持的音频扩展名 (小写)
const AUDIO_EXTS: [&str; 8] = ["wav", "mp3", "ogg", "aac", "flac", "m4a", "opus", "webm"];

/// 扫入一个文件夹内的音频文件路径 (递归扫描, 供「一键扫入整个文件夹」使用)
/// invoke("tts_list_audio_files", { dir: "C:/ref" })
/// 返回按绝对路径排序的音频文件路径列表.
#[tauri::command]
pub fn tts_list_audio_files(dir: String) -> Result<Vec<String>, String> {
    let root = std::path::PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("所选路径不是文件夹: {dir}"));
    }
    let mut found = Vec::new();
    walk_audio(&root, &mut found);
    found.sort();
    Ok(found)
}

/// 递归收集音频文件 (跳过符号链接 / 联结点, 防止目录循环导致无限递归)
fn walk_audio(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        // 跳过符号链接 / junction, 避免循环指向祖先目录造成递归爆炸
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk_audio(&path, out);
        } else if meta.is_file() {
            let ext = path
                .extension()
                .and_then(|n| n.to_str())
                .map(|n| n.to_ascii_lowercase());
            if ext.as_deref().map(|e| AUDIO_EXTS.contains(&e)).unwrap_or(false) {
                out.push(path.to_string_lossy().to_string());
            }
        }
    }
}

/// 测试某个地址是否可达 (GET 该地址的根路径)
/// invoke("tts_test_connection", { url: "http://127.0.0.1:9880" })
///
/// 返回 HTTP 状态码 (2xx/4xx 都代表服务在线), 网络不可达 / 超时返回 Err.
#[tauri::command]
pub async fn tts_test_connection(url: String) -> Result<u16, String> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(6)).build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("无法连接 {url}: {e}"))?;
    Ok(response.status().as_u16())
}

/// TTS 合成产物 (由后端保存到本地, 前端通过 asset 协议播放)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsAudioResult {
    /// asset 协议相对路径, 例: `tts/tts_<timestamp>.wav`
    pub asset_path: String,
    /// 文件名
    pub file_name: String,
    /// 文件大小 (bytes)
    pub size: u64,
}

/// 发起一次 TTS 合成请求并保存音频
///
/// `url` 为合成接口完整地址 (含 HTTP 协议与端口), 例如 `http://127.0.0.1:9880/tts`.
/// 采用 POST + JSON body (与 GPT-SoVITS api_v2.py 的 POST 接口一致);
/// `params` 为整个 JSON 请求体对象, 具体字段由适配器决定 (如 GPT-SoVITS 的
/// text / text_lang / ref_audio_path / prompt_lang / prompt_text / media_type 等).
/// `extension` 为产物扩展名 (如 wav / ogg), 无点号.
/// 响应体字节会写入 `temp/tts/tts_<timestamp>.<ext>`, 供前端播放.
#[tauri::command]
pub async fn tts_synthesize(
    app: tauri::AppHandle,
    url: String,
    params: serde_json::Value,
    extension: String,
) -> Result<TtsAudioResult, String> {
    let response = Client::new()
        .post(&url)
        .json(&params)
        .send()
        .await
        .map_err(|e| format!("TTS 请求失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        // 尝试读取错误 body (通常是 FastAPI 的 JSON 错误)
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("<无法读取错误响应>"));
        let message = extract_error_message(&body);
        return Err(format!("TTS 接口返回 {status}: {message}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 TTS 音频流失败: {e}"))?;
    if bytes.is_empty() {
        return Err("TTS 接口返回了空音频".to_string());
    }
    // 缓存目录: <应用数据目录>/temp/tts
    // 合成音频是临时产物, 放进系统的 temp 目录 (而非 resources),
    // 由下面的 prune_cache 在每次合成时清理 2 小时前的旧文件.
    let cache_dir = crate::resource::temp_dir(&app)
        .map_err(|e| e.to_string())?
        .join("tts");
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("创建 TTS 缓存目录失败: {e}"))?;
    // 清理旧产物, 避免缓存无限增长 (仅清理 2 小时前的文件)
    prune_cache(&cache_dir);

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ext = sanitize_extension(&extension);
    let file_name = format!("tts_{stamp}.{ext}");
    let file_path = cache_dir.join(&file_name);
    std::fs::write(&file_path, &bytes).map_err(|e| format!("保存 TTS 音频失败: {e}"))?;
    let size = bytes.len() as u64;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("TTS 合成完成: {} bytes -> {}", size, file_path.display()),
    );
    Ok(TtsAudioResult {
        asset_path: format!("tts/{file_name}"),
        file_name,
        size,
    })
}

/// 清洗扩展名, 仅允许 1~8 位字母数字, 拒绝路径分隔符等危险字符.
/// 非法时回退为 `wav` (合成产物按 media_type 出内容, 文件名扩展名仅用于缓存).
fn sanitize_extension(raw: &str) -> String {
    let ext = raw.trim().to_ascii_lowercase();
    let valid = !ext.is_empty()
        && ext.chars().count() <= 8
        && ext.chars().all(|c| c.is_ascii_alphanumeric());
    if valid { ext } else { "wav".to_string() }
}

/// 从错误响应体中提取供展示的消息
/// (FastAPI 的 4xx 错误通常是 `{ "detail": "...", "message": "...", "Exception": "..." }`)
///
/// 优先级: `detail` > 有效的 `message` > `Exception` > 原始 JSON 节选。
/// GPT-SoVITS api_v2.py 合成失败时返回 `{"message":"tts failed","Exception":<真实原因>}`,
/// 这里的 `message` 是无信息量的占位文案,真正的根因在 `Exception` 里,
/// 因此必须跳过这类占位、继续透传 `Exception`,否则前端只能看到笼统的 "tts failed"。
fn extract_error_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        for key in ["detail", "message", "Exception"] {
            if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
                if !text.is_empty() && !is_placeholder_message(text, key) {
                    return text.to_string();
                }
            }
        }
        // 兜底: 只取前若干字符的原始 JSON
        if body.trim_start().starts_with('{') {
            return body.chars().take(240).collect();
        }
    }
    body.chars().take(240).collect()
}

/// 判断某个错误消息是否为「无信息量的占位文案」,需要继续向后取真因。
/// 仅对 `message` 字段生效;`detail` / `Exception` 不参与该过滤。
fn is_placeholder_message(text: &str, key: &str) -> bool {
    if key != "message" {
        return false;
    }
    let trimmed = text.trim().to_ascii_lowercase();
    trimmed.is_empty() || matches!(
        trimmed.as_str(),
        "tts failed" | "tts 合成失败" | "合成失败" | "failed"
    )
}

/// 读取本地参考音频文件字节, 供前端预览播放.
/// invoke("tts_read_audio_file", { path: "E:/xxx/ref.wav" })
///
/// 任意绝对路径的参考音频可能不在 asset 协议代理的 resources 目录内,
/// 因此这里直接经 Tauri 命令读回字节, 前端用 Blob 转可播放 URL.
/// 仅允许音频扩展名, 且必须是普通文件 (拒绝目录 / 符号链接).
#[tauri::command]
pub fn tts_read_audio_file(path: String) -> Result<Vec<u8>, String> {
    let file = std::path::Path::new(&path);
    // 拒绝空 / 相对路径
    if !file.is_absolute() {
        return Err(format!("参考音频必须为绝对路径: {path}"));
    }
    // 拒绝符号链接 / 联结点, 避免解析到非预期位置
    let meta = std::fs::symlink_metadata(file)
        .map_err(|e| format!("无法访问参考音频 {path}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err(format!("参考音频不支持符号链接: {path}"));
    }
    if !meta.is_file() {
        return Err(format!("参考音频不是普通文件: {path}"));
    }
    // 只允许音频扩展名
    let ext = file
        .extension()
        .and_then(|n| n.to_str())
        .map(|n| n.to_ascii_lowercase());
    if !ext.as_deref().map(|e| AUDIO_EXTS.contains(&e)).unwrap_or(false) {
        return Err(format!("不支持该文件类型: {path}"));
    }
    std::fs::read(file).map_err(|e| format!("读取参考音频失败 {path}: {e}"))
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
        let body = r#"{"message":"tts failed","Exception":"参考音频在3~10秒范围外，请更换！"}"#;
        assert_eq!(extract_error_message(body), "参考音频在3~10秒范围外，请更换！");
    }
}

/// 清理 temp/tts 目录中超过 2 小时的旧文件
fn prune_cache(dir: &PathBuf) {
    let ok = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let threshold = ok.saturating_sub(2 * 60 * 60);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    let modified = metadata
                        .modified()
                        .map(|d| d.duration_since(std::time::UNIX_EPOCH).map(|e| e.as_secs() as i64).unwrap_or(0))
                        .unwrap_or(0);
                    if modified < threshold {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
}
