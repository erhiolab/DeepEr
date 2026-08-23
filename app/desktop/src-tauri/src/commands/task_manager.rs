//! 浏览器任务管理器 (Browser Task Manager) 命令

use crate::log;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_6;
#[cfg(windows)]
use windows::core::Interface;


#[tauri::command]
pub fn open_task_manager(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let window = app
            .get_webview_window("deeper")
            .ok_or_else(|| {
                let _ = log::write(&app, &log::LogSource::Backend, "error", "打开任务管理器失败: 未找到主窗口");
                "未找到主窗口".to_string()
            })?;

        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

        window
            .with_webview(move |platform| {
                let controller = platform.controller();
                let result = unsafe {
                    controller
                        .CoreWebView2()
                        .map_err(|e| format!("获取核心 WebView2 失败: {e}"))
                        .and_then(|core| {
                            core.cast::<ICoreWebView2_6>()
                                .map_err(|e| format!("当前 WebView2 版本不支持任务管理器: {e}"))
                        })
                        .and_then(|w6| {
                            w6.OpenTaskManagerWindow()
                                .map_err(|e| format!("打开任务管理器失败: {e}"))
                        })
                };
                let _ = tx.send(result);
            })
            .map_err(|e| {
                let msg = format!("调度打开任务管理器失败: {e}");
                let _ = log::write(&app, &log::LogSource::Backend, "error", &msg);
                msg
            })?;

        rx.recv().map_err(|e| {
            let msg = format!("等待打开任务管理器响应失败: {e}");
            let _ = log::write(&app, &log::LogSource::Backend, "error", &msg);
            msg
        })?
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("浏览器任务管理器仅在 Windows 上可用".to_string())
    }
}
