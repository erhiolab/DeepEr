//! 开发者工具 (DevTools) 运行时开关命令

use crate::log;
use tauri::Manager;

/// 切换当前主窗口的开发者工具开/关, 返回切换后的状态 (true = 已打开)
#[tauri::command]
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
