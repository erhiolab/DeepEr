//! 系统语言命令

use crate::log;

/// 获取系统语言
#[tauri::command]
pub fn get_system_language(app: tauri::AppHandle) -> String {
    let language = sys_locale::get_locale().unwrap_or_else(|| "zh-CN".to_string());
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("检测到系统语言: {language}"),
    );
    language
}
