//! 首次运行相关命令

use crate::db::Db;
use crate::log;
use tauri::State;

/// 检查是否是首次启动应用
#[tauri::command]
pub fn is_first_run(state: State<'_, Db>) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::config::is_first_run(&conn).map_err(|e| e.to_string())
}

/// 首次启动完成
#[tauri::command]
pub fn complete_first_run(app: tauri::AppHandle, state: State<'_, Db>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::config::mark_first_run_completed(&conn).map_err(|e| e.to_string())?;
    crate::config::mark_initialized(&conn).map_err(|e| e.to_string())?;
    let _ = log::write(&app, &log::LogSource::Backend, "info", "首次初始化完成");
    Ok(())
}
