//! 开发者工具 (DevTools) 运行时开关命令
//!
//! 前端通过 `invoke("toggle_devtools")` 调用.
//! 仅在应用内部需要时 (如"异常处理"页) 手动打开/关闭控制台,
//! 窗口配置保持 `devtools: false` 以禁用默认入口/快捷键.

use tauri::Manager;

/// 切换当前主窗口的开发者工具开/关, 返回切换后的状态 (true = 已打开)
#[tauri::command]
pub fn toggle_devtools(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("deeper")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    if window.is_devtools_open() {
        window.close_devtools();
        Ok(false)
    } else {
        window.open_devtools();
        Ok(true)
    }
}
