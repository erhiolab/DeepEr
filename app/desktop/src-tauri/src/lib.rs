mod asset;
mod commands;
mod config;
mod db;
mod log;
mod resource;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 资源文件通道: 通过 `asset://` / `http://asset.localhost` 把 `data` 目录
        .register_uri_scheme_protocol(asset::SCHEME, |ctx, request| asset::handle(&ctx, request))
        // 插件: 打开文件
        .plugin(tauri_plugin_opener::init())
        // 插件: 粘贴板管理
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_handle = app.handle();
            // 初始化托盘
            tray::init(app_handle).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            // 初始化日志
            log::init(app_handle)?;
            log::write(
                app_handle,
                &log::LogSource::Backend,
                "info",
                "日志系统初始化完成",
            )?;
            // 初始化数据库
            let db_handle = db::init(app_handle)?;
            // 初始化资源目录 (资源和下载临时目录)
            resource::init(app_handle).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            log::write(
                app_handle,
                &log::LogSource::Backend,
                "info",
                "资源目录初始化完成",
            )?;
            app.manage(db_handle);
            log::write(
                app_handle,
                &log::LogSource::Backend,
                "info",
                "应用初始化完成",
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::is_first_run,
            commands::complete_first_run,
            commands::write_log,
            commands::get_system_language,
            commands::fetch_llm_models,
            config::get_config,
            config::set_config,
            config::delete_config,
            config::has_config,
            config::get_all_configs,
            config::get_init_config,
            commands::check_resource,
            commands::ensure_resource
        ])
        .run(tauri::generate_context!())
        .expect("运行应用时出错")
}
