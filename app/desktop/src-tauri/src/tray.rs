//! 托盘菜单模块
//!
//! 菜单项文字会随状态动态更新:
//! - 主界面项: 当前非主界面时显示"打开主界面", 主界面时显示"回到桌宠"
//! - 隐藏/显示项: 窗口隐藏时显示"显示", 显示时显示"隐藏"

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager, Wry,
};

use crate::log;

/// 主窗口 label
const MAIN_WINDOW_LABEL: &str = "deeper";

/// 事件名: 通知前端导航 (payload: "main" | "pet")
const EVT_NAVIGATE: &str = "tray-navigate";
/// 事件名: 前端回传当前视图是否为"主界面" (payload: true | false)
const EVT_SET_VIEW: &str = "tray-set-view";
/// 事件名: 前端开启穿透 (payload: true | false)
const EVT_SET_PASSTHROUGH: &str = "pet-passthrough";
/// 事件名: 后端"取消穿透"通知前端恢复鼠标
const EVT_CANCEL_PASSTHROUGH: &str = "tray-cancel-passthrough";
/// 事件名: 通知前端"复位" (窗口居中显示, 并重置数据库中的窗口位置/大小)
const EVT_RESET: &str = "tray-reset";
/// 事件名: 前端回传复位已完成 (重新启用"复位"菜单项)
const EVT_RESET_DONE: &str = "tray-reset-done";

/// 菜单项 ID: 显示主界面 / 回到桌宠
const MENU_SHOW_MAIN: &str = "tray.show_main";
/// 菜单项 ID: 隐藏/显示主窗口
const MENU_TOGGLE: &str = "tray.toggle";
/// 菜单项 ID: 取消点击穿透 (穿透时可用)
const MENU_CANCEL_PASSTHROUGH: &str = "tray.cancel_passthrough";
/// 菜单项 ID: 复位 (窗口居中显示, 重置桌宠位置/大小记录)
const MENU_RESET: &str = "tray.reset";
/// 菜单项 ID: 退出应用
const MENU_QUIT: &str = "tray.quit";

/// 初始化系统托盘
pub fn init(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let _ = log::write(
        app_handle,
        &log::LogSource::Backend,
        "info",
        "初始化托盘菜单",
    );

    // 记录当前是否处于"主界面"视图 (由前端路由变化回传)
    let in_main = std::sync::Arc::new(AtomicBool::new(false));

    // 创建菜单项
    let show_main =
        MenuItem::with_id(app_handle, MENU_SHOW_MAIN, "打开主界面", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app_handle, MENU_TOGGLE, "显示", true, None::<&str>)?;
    // "取消穿透"初始禁用, 前端开启穿透后才可用
    let cancel_passthrough = MenuItem::with_id(
        app_handle,
        MENU_CANCEL_PASSTHROUGH,
        "取消穿透",
        false,
        None::<&str>,
    )?;
    let reset = MenuItem::with_id(app_handle, MENU_RESET, "复位", true, None::<&str>)?;
    let quit = MenuItem::with_id(app_handle, MENU_QUIT, "退出", true, None::<&str>)?;
    // 创建菜单
    let menu = Menu::with_items(
        app_handle,
        &[&show_main, &toggle, &cancel_passthrough, &reset, &quit],
    )?;

    // 克隆一份供闭包内动态更新文字
    let show_main_menu = show_main.clone();
    let toggle_menu = toggle.clone();
    let in_main_menu = in_main.clone();
    // 取消穿透项克隆供菜单事件/前端穿透事件使用
    let cancel_pt_menu = cancel_passthrough.clone();
    let cancel_pt_evt = cancel_passthrough.clone();

    // 前端开启穿透时回传, 启用"取消穿透"菜单项
    let _ = app_handle.listen(EVT_SET_PASSTHROUGH, move |event| {
        let passthrough = event.payload() == "true";
        let _ = cancel_pt_evt.set_enabled(passthrough);
    });

    // 前端复位完成后回传, 重新启用"复位"菜单项
    let reset_evt = reset.clone();
    let _ = app_handle.listen(EVT_RESET_DONE, move |_event| {
        let _ = reset_evt.set_enabled(true);
    });

    // 克隆一份供前端视图回传事件监听使用
    let show_main_evt = show_main.clone();
    let in_main_evt = in_main.clone();
    let app_handle_evt = app_handle.clone();

    // 前端在路由变化时回传当前视图, 用于切换"打开主界面/回到桌宠"
    let _ = app_handle.listen(EVT_SET_VIEW, move |event| {
        let is_main = event.payload() == "true";
        in_main_evt.store(is_main, Ordering::Release);
        let text = if is_main { "回到桌宠" } else { "打开主界面" };
        if let Err(error) = show_main_evt.set_text(text) {
            let _ = log::write(
                &app_handle_evt,
                &log::LogSource::Backend,
                "error",
                &format!("更新托盘菜单文字失败: {error}"),
            );
        }
    });

    // 获取应用图标作为托盘图标
    let icon = app_handle
        .default_window_icon()
        .ok_or("无法获取应用图标")?
        .clone();
    // 构建托盘图标
    // 克隆一份供菜单事件回调使用
    let reset_menu = reset.clone();
    let _tray = TrayIconBuilder::new()
        .icon(icon.clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let _ = handle_menu_event(
                app,
                &event.id.0,
                &show_main_menu,
                &toggle_menu,
                &cancel_pt_menu,
                &reset_menu,
                &in_main_menu,
            );
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                // 左键点击托盘图标: 显示主界面 (回到桌宠时则切回主界面)
                let _ = show_main_action(app, &show_main, &toggle, &in_main);
            }
        })
        .tooltip("DeepEr - 显示主界面")
        .build(app_handle)?;
    let _ = log::write(
        app_handle,
        &log::LogSource::Backend,
        "info",
        "托盘菜单初始化完成",
    );
    Ok(())
}

/// 处理菜单项点击事件
#[allow(clippy::too_many_arguments)]
fn handle_menu_event(
    app: &AppHandle,
    menu_id: &str,
    show_main: &MenuItem<Wry>,
    toggle: &MenuItem<Wry>,
    cancel_passthrough: &MenuItem<Wry>,
    reset: &MenuItem<Wry>,
    in_main: &AtomicBool,
) -> Result<(), Box<dyn std::error::Error>> {
    match menu_id {
        MENU_SHOW_MAIN => {
            let _ = log::write(app, &log::LogSource::Backend, "info", "托盘菜单：显示主界面");
            show_main_action(app, show_main, toggle, in_main)?;
        }
        MENU_TOGGLE => {
            let _ = log::write(
                app,
                &log::LogSource::Backend,
                "info",
                "托盘菜单：切换主窗口显示/隐藏",
            );
            toggle_action(app, show_main, toggle, in_main)?;
        }
        MENU_CANCEL_PASSTHROUGH => {
            let _ = log::write(app, &log::LogSource::Backend, "info", "托盘菜单：取消点击穿透");
            // 恢复窗口鼠标交互 (前端收到事件后 setIgnoreCursorEvents(false))
            app.emit(EVT_CANCEL_PASSTHROUGH, ())?;
            cancel_passthrough.set_enabled(false)?;
        }
        MENU_RESET => {
            let _ = log::write(app, &log::LogSource::Backend, "info", "托盘菜单：复位窗口");
            // 复位期间禁用该菜单项, 防止重复触发 (前端完成后恢复)
            reset.set_enabled(false)?;
            // 显示主窗口, 居中显示并重置数据库中的桌宠位置/大小记录 (由前端完成)
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                window.show()?;
            }
            app.emit(EVT_RESET, ())?;
        }
        MENU_QUIT => {
            let _ = log::write(app, &log::LogSource::Backend, "info", "托盘菜单：退出应用");
            app.exit(0);
        }
        _ => {
            let _ = log::write(
                app,
                &log::LogSource::Backend,
                "warn",
                &format!("未知的菜单项 ID: {}", menu_id),
            );
        }
    }
    Ok(())
}

/// "打开主界面 / 回到桌宠" 动作:
/// 当前在主界面 → 回到桌宠; 否则 → 打开主界面. 均会显示窗口.
fn show_main_action(
    app: &AppHandle,
    show_main: &MenuItem<Wry>,
    toggle: &MenuItem<Wry>,
    in_main: &AtomicBool,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show()?;
        window.set_focus()?;
    }
    // 通知前端导航到主界面或桌宠
    let is_main = in_main.load(Ordering::Acquire);
    let target = if is_main { "pet" } else { "main" };
    app.emit(EVT_NAVIGATE, target)?;
    // 更新两个菜单项文字
    refresh_texts(app, show_main, toggle, if is_main { "pet" } else { "main" })?;
    Ok(())
}

/// "隐藏/显示" 动作: 翻转主窗口可见性, 并更新菜单文字.
fn toggle_action(
    app: &AppHandle,
    show_main: &MenuItem<Wry>,
    toggle: &MenuItem<Wry>,
    in_main: &AtomicBool,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let is_visible = window.is_visible()?;
        if is_visible {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
    }
    let is_visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    // 更新菜单文字 (显示/隐藏 按窗口可见性; 主界面项保留当前视图状态)
    let view = if in_main.load(Ordering::Acquire) { "main" } else { "pet" };
    refresh_texts(app, show_main, toggle, view)?;
    let _ = log::write(
        app,
        &log::LogSource::Backend,
        "info",
        &format!("托盘操作：主窗口已{}", if is_visible { "显示" } else { "隐藏" }),
    );
    Ok(())
}

/// 根据当前目标视图与窗口可见性刷新两个菜单项的文字.
fn refresh_texts(
    app: &AppHandle,
    show_main: &MenuItem<Wry>,
    toggle: &MenuItem<Wry>,
    target_view: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let show_text = if target_view == "pet" { "打开主界面" } else { "回到桌宠" };
    show_main.set_text(show_text)?;

    let visible = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let toggle_text = if visible { "隐藏" } else { "显示" };
    toggle.set_text(toggle_text)?;
    Ok(())
}
