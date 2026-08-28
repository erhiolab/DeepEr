mod asset;
mod agent;
mod commands;
mod config;
mod db;
mod log;
mod resource;
mod secret;
mod tool;
mod tray;
mod api;

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
        // 插件: 文件 / 目录对话框
        .plugin(tauri_plugin_dialog::init())
        // 插件: 进程控制 (应用重启)
        .plugin(tauri_plugin_process::init())
        // 插件: 自动更新
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle();
            // 初始化日志
            log::init(app_handle)?;
            log::write(
                app_handle,
                &log::LogSource::Backend,
                "info",
                "日志系统初始化完成",
            )?;
            // 初始化数据库 (先于托盘: 托盘初始化时需要读取首次运行状态)
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
            // 校准资源索引 (磁盘 ⇄ DB): 启动时执行一次, 之后列表直接从 DB 读
            if let Some(state) = app.try_state::<db::Db>() {
                if let Ok(conn) = state.0.lock() {
                    if let Ok(data_dir) = db::data_dir(app_handle) {
                        resource::index::reconcile(&conn, &data_dir);
                    }
                }
            }
            // 判断是否首次启动: 首次启动 (引导阶段) 托盘仅开放"控制台/退出"
            let first_run = app
                .try_state::<db::Db>()
                .map(|state| {
                    state
                        .0
                        .lock()
                        .map(|conn| config::is_first_run(&conn).unwrap_or(false))
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            // 初始化托盘
            tray::init(app_handle, first_run)
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            log::write(
                app_handle,
                &log::LogSource::Backend,
                "info",
                "应用初始化完成",
            )?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::first_run::complete_first_run,
            commands::log::write_log,
            commands::language::get_system_language,
            commands::live2d::fetch_live2d_list,
            commands::context::context_insert,
            commands::context::context_list,
            commands::persona::persona_list,
            commands::persona::persona_get,
            commands::persona::persona_create,
            commands::persona::persona_update,
            commands::persona::persona_delete,
            commands::persona::persona_select,
            commands::persona::persona_import_file,

            commands::tools::tool_list,
            commands::tools::tool_search,
            commands::tool::tool_execute,
            commands::agent::agent_run,

            commands::llm::openai_responses::llm_openai_generate,
            commands::llm::openai_responses::llm_openai_test_connection,
            commands::llm::openai_responses::llm_openai_list_models,
            commands::llm::anthropic_messages::llm_anthropic_generate,
            commands::llm::anthropic_messages::llm_anthropic_test_connection,
            commands::llm::google_genai::llm_google_generate,
            commands::llm::google_genai::llm_google_test_connection,
            commands::llm::google_genai::llm_google_list_models,

            commands::tts::tts_list_audio_files,
            commands::tts::tts_read_audio_file,
            commands::tts::gptsovits::tts_gptsovits_synthesize,
            commands::tts::gptsovits::tts_gptsovits_test_connection,

            config::get_config,
            config::set_config,
            config::delete_config,
            config::has_config,
            config::get_all_configs,
            config::get_init_config,
            secret::secret_encrypt,
            secret::secret_decrypt,

            commands::resource::check_resource,
            commands::resource::ensure_resource,
            commands::resource::list_resources,
            commands::resource::delete_resource,
            commands::resource::import_live2d,

            commands::resource::read_model_config,
            commands::resource::write_model_config,
            commands::resource::export_model_config,
            commands::resource::import_model_config,
            commands::resource::save_model_cover,
            commands::resource::delete_model_cover,

            commands::devtools::toggle_devtools,
            commands::task_manager::open_task_manager
        ])
        .run(tauri::generate_context!())
        .expect("运行应用时出错")
}
