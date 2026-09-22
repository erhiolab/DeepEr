//! 开发者工具 (DevTools) 运行时开关命令

#[cfg(debug_assertions)]
use crate::log;
#[cfg(debug_assertions)]
use tauri::Manager;

/// 切换当前主窗口的开发者工具开/关, 返回切换后的状态 (true = 已打开)
#[tauri::command]
#[cfg(debug_assertions)]
pub fn toggle_devtools(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_webview_window("deeper").ok_or_else(|| {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "error",
            "打开开发者工具失败: 未找到主窗口",
        );
        "未能找到主窗口".to_string()
    })?;

    if window.is_devtools_open() {
        window.close_devtools();
        let _ = log::write(&app, &log::LogSource::Backend, "info", "已关闭开发者工具");
        Ok(false)
    } else {
        window.open_devtools();
        let _ = log::write(&app, &log::LogSource::Backend, "info", "已打开开发者工具");
        Ok(true)
    }
}

/// Release 构建不编译 Tauri DevTools 能力；保留命令签名以兼容前端调用。
#[tauri::command]
#[cfg(not(debug_assertions))]
pub fn toggle_devtools(_app: tauri::AppHandle) -> Result<bool, String> {
    Err("生产构建未启用开发者工具".to_string())
}
