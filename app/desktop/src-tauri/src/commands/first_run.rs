//! 首次运行相关命令

use crate::db::Db;
use crate::log;
use tauri::{Emitter, State};

/// 首次启动完成
#[tauri::command]
pub fn complete_first_run(app: tauri::AppHandle) -> Result<(), String> {
    let _ = log::write(&app, &log::LogSource::Backend, "info", "首次初始化完成");
    let _ = app.emit(crate::tray::EVT_FIRST_RUN_DONE, ());
    Ok(())
}
