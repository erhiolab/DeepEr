//! 首次运行相关命令

use crate::db::Db;
use crate::log;
use tauri::{Emitter, State};

/// 检查是否是首次启动应用
#[tauri::command]
pub fn is_first_run(state: State<'_, Db>) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    crate::config::is_first_run(&conn).map_err(|e| e.to_string())
}

/// 首次启动完成
#[tauri::command]
pub fn complete_first_run(app: tauri::AppHandle, state: State<'_, Db>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "error",
            &format!("首次初始化失败: 获取数据库锁失败: {e}"),
        );
        e.to_string()
    })?;
    crate::config::mark_first_run_completed(&conn).map_err(|e| {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "error",
            &format!("首次初始化失败: 标记完成失败: {e}"),
        );
        e.to_string()
    })?;
    crate::config::mark_initialized(&conn).map_err(|e| {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "error",
            &format!("首次初始化失败: 记录初始化时间失败: {e}"),
        );
        e.to_string()
    })?;
    let _ = log::write(&app, &log::LogSource::Backend, "info", "首次初始化完成");
    // 通知托盘恢复首次运行时被禁用的菜单项 (打开主界面/显示隐藏/复位等)
    let _ = app.emit(crate::tray::EVT_FIRST_RUN_DONE, ());
    Ok(())
}
