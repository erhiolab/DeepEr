//! TTS 适配器命令模块
//! - [`gptsovits`] GPT-SoVITS(API V2)

pub mod gptsovits;

use rusqlite::Connection;
use std::path::PathBuf;

use crate::config::{self, ConfigValue};
use crate::db;

/// 从数据库读取配置项字符串值 (缺失返回 None)
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
pub(crate) fn read_db_string_or(conn: &Connection, key: &str, fallback: &str) -> Result<String, String> {
    Ok(read_db_string(conn, key)?.unwrap_or_else(|| fallback.to_string()))
}

/// 从应用拿唯一 DB 连接的锁 (供各命令复用)
pub(crate) fn db_conn<'a>(
    state: &'a tauri::State<'_, db::Db>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|e| e.to_string())
}

/// 支持的音频扩展名 (小写)
const AUDIO_EXTS: [&str; 8] = ["wav", "mp3", "ogg", "aac", "flac", "m4a", "opus", "webm"];

/// 扫描一个文件夹内的音频文件路径 (递归扫描, 供"一键扫描整个文件夹"使用)
/// invoke("tts_list_audio_files", { dir: "C:/ref" })
#[tauri::command]
pub fn tts_list_audio_files(dir: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("所选路径不是文件夹: {dir}"));
    }
    let mut found = Vec::new();
    walk_audio(&root, &mut found);
    found.sort();
    Ok(found)
}

/// 递归收集音频文件 (跳过符号链接 / 联接点)
fn walk_audio(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
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

/// 读取本地参考音频文件字节, 供前端预览播放
/// invoke("tts_read_audio_file", { path: "E:/xxx/ref.wav" })
#[tauri::command]
pub fn tts_read_audio_file(path: String) -> Result<Vec<u8>, String> {
    let file = std::path::Path::new(&path);
    if !file.is_absolute() {
        return Err(format!("参考音频必须为绝对路径: {path}"));
    }
    let meta = std::fs::symlink_metadata(file)
        .map_err(|e| format!("无法访问参考音频 {path}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err(format!("参考音频不支持符号链接: {path}"));
    }
    if !meta.is_file() {
        return Err(format!("参考音频不是普通文件: {path}"));
    }
    let ext = file
        .extension()
        .and_then(|n| n.to_str())
        .map(|n| n.to_ascii_lowercase());
    if !ext.as_deref().map(|e| AUDIO_EXTS.contains(&e)).unwrap_or(false) {
        return Err(format!("不支持该文件类型: {path}"));
    }
    std::fs::read(file).map_err(|e| format!("读取参考音频失败 {path}: {e}"))
}
