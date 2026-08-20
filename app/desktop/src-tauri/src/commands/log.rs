//! 日志写入命令

use crate::log as log_service;

/// 前端写日志
#[tauri::command]
pub fn write_log(app: tauri::AppHandle, level: String, message: String) -> Result<(), String> {
    log_service::write(&app, &log_service::LogSource::Frontend, &level, &message)
        .map_err(|e| e.to_string())
}
