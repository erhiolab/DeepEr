//! 资源相关命令
//! 下载 / 检查 / 列表 / 删除 / 导入, 以及 `resource-download` / `resource-import` 进度事件
//!
//! 性能策略:
//! - 列表 (`list_resources`) 直接从 SQLite `resources` 索引表读, 不遍历磁盘文件夹.
//! - 下载 / 导入等耗时 IO 通过 `tauri::async_runtime::spawn_blocking` 放到阻塞池,
//!   命令本身 async, 返回即时, 进度靠事件推送, 不卡渲染线程.

use crate::db;
use crate::log;
use crate::resource::{DownloadProgress, ResourceType};
use crate::db::Db;
use tauri::{Emitter, Manager as _, State};

/// 资源进度事件载荷 (下载 / 导入共用结构, 仅事件名不同)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProgressEvent {
    /// 资源类型
    pub resource_type: String,
    /// 当前阶段:
    /// - installed
    /// - downloading
    /// - download-done
    /// - extracting
    /// - done
    /// - error
    /// (导入时: importing / done / error)
    pub step: String,
    /// 当前百分比 (复制 / 下载)
    pub progress: Option<f32>,
    /// 已处理字节数
    pub processed: Option<u64>,
    /// 总字节数
    pub total: Option<u64>,
    /// 错误信息
    pub message: Option<String>,
}

/// 解析资源类型
fn parse_resource_type(value: &str) -> Result<ResourceType, String> {
    ResourceType::from_str(value).ok_or_else(|| format!("未知的资源类型: {value}"))
}

/// 检查资源名称
fn validate_resource_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("资源名称不能为空".to_string());
    }
    crate::resource::validate_resource_name(name)?;
    Ok(name)
}

/// 检查资源是否已安装 (磁盘检查)
/// invoke("check_resource", { resourceType: "live2d", name: "arg-nori" })
#[tauri::command]
pub fn check_resource(
    app: tauri::AppHandle,
    resource_type: String,
    name: String,
) -> Result<bool, String> {
    let resource_type = parse_resource_type(&resource_type)?;
    let name = validate_resource_name(&name)?;
    let installed = crate::resource::is_installed(&app, resource_type, name)?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!(
            "检查资源: type={} name={} installed={installed}",
            resource_type.as_str(),
            name
        ),
    );
    Ok(installed)
}

/// 确保资源已经安装 (async)
/// 未安装时执行: 获取下载地址 → 下载 ZIP → 安全解压 → 写索引
/// 耗时 IO 在 spawn_blocking 中执行, 命令立即返回, 进度通过 resource-download 事件推送.
/// invoke("ensure_resource", { resourceType: "live2d", name: "arg-nori" })
#[tauri::command]
pub async fn ensure_resource(
    app: tauri::AppHandle,
    resource_type: String,
    name: String,
) -> Result<(), String> {
    let resource_type = parse_resource_type(&resource_type)?;
    let name = validate_resource_name(&name)?.to_string();
    let type_name = resource_type.as_str().to_string();
    const EVENT: &str = "resource-download";

    // 快速路径: 已安装 → 直接回已安装事件
    if crate::resource::is_installed(&app, resource_type, &name)? {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "info",
            &format!("资源已安装: type={type_name} name={name}"),
        );
        emit_resource_event(&app, EVENT, &type_name, "installed", Some(100.0), None, None, None);
        return Ok(());
    }

    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("开始下载资源: type={type_name} name={name}"),
    );

    // 移到阻塞线程执行, 命令立即返回, 进度靠事件
    let work_app = app.clone();
    let work_type = type_name.clone();
    let work_name = name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        do_download(&work_app, &work_type, resource_type, &work_name, &data_dir);
    });

    Ok(())
}

/// 在阻塞线程中执行完整的下载 + 解压 + 校验 + 索引写入
fn do_download(
    app: &tauri::AppHandle,
    type_name: &str,
    resource_type: ResourceType,
    name: &str,
    data_dir: &std::path::Path,
) {
    const EVENT: &str = "resource-download";

    emit_resource_event(app, EVENT, type_name, "downloading", Some(0.0), Some(0), None, None);

    let progress_app = app.clone();
    let progress_type = type_name.to_string();
    let progress_callback = move |progress: DownloadProgress| {
        emit_resource_event(
            &progress_app,
            EVENT,
            &progress_type,
            "downloading",
            progress.percentage,
            Some(progress.downloaded),
            progress.total,
            None,
        );
    };

    let zip_path = match crate::resource::downloader::download_to_zip(
        &resource_type, name, data_dir, progress_callback,
    ) {
        Ok(path) => path,
        Err(error) => {
            let message = error.to_string();
            let _ = log::write(
                app,
                &log::LogSource::Backend,
                "error",
                &format!("下载资源失败: type={type_name} name={name} error={message}"),
            );
            emit_resource_event(app, EVENT, type_name, "error", None, None, None, Some(message));
            return;
        }
    };

    emit_resource_event(app, EVENT, type_name, "download-done", Some(100.0), None, None, None);
    emit_resource_event(app, EVENT, type_name, "extracting", None, None, None, None);

    let target_dir = data_dir
        .join(crate::resource::RESOURCES_DIR)
        .join(resource_type.dir_name())
        .join(name);
    if target_dir.exists() {
        let _ = std::fs::remove_dir_all(&target_dir);
    }
    if let Err(error) = std::fs::create_dir_all(&target_dir) {
        let message = format!("创建资源目录失败: {error}");
        emit_resource_event(app, EVENT, type_name, "error", None, None, None, Some(message));
        return;
    }
    if let Err(error) = crate::resource::downloader::extract_zip(&zip_path, &target_dir) {
        let _ = std::fs::remove_dir_all(&target_dir);
        let message = error.to_string();
        let _ = log::write(
            app,
            &log::LogSource::Backend,
            "error",
            &format!("解压资源失败: type={type_name} name={name} error={message}"),
        );
        emit_resource_event(app, EVENT, type_name, "error", None, None, None, Some(message));
        return;
    }
    let _ = std::fs::remove_file(&zip_path);

    // 校验安装结果 (Live2D 模型必须包含 .model.json 或 .model3.json)
    let installed = crate::resource::is_installed(app, resource_type, name)
        .unwrap_or(false);
    if !installed {
        let message = format!("资源解压后校验失败: type={type_name} name={name}");
        let _ = log::write(app, &log::LogSource::Backend, "error", &message);
        emit_resource_event(app, EVENT, type_name, "error", None, None, None, Some(message));
        return;
    }

    // 写索引 (官方下载的来源标记为 is_official = true)
    record_index(app, resource_type, name, true);

    emit_resource_event(app, EVENT, type_name, "done", Some(100.0), None, None, None);
    let _ = log::write(
        app,
        &log::LogSource::Backend,
        "info",
        &format!("资源就位: type={type_name} name={name} path={}", target_dir.display()),
    );
}

/// 把资源元信息写入 SQLite 索引表 (官方: true / 用户导入: false)
fn record_index(app: &tauri::AppHandle, resource_type: ResourceType, name: &str, is_official: bool) {
    let data_dir = match db::data_dir(app) {
        Ok(dir) => dir,
        Err(_) => return,
    };
    // 从磁盘探测入口文件与大小
    let (entry_file, size) = match crate::resource::live2d::get(&data_dir, name) {
        Ok(info) => (info.entry_file, info.size),
        Err(_) => (None, 0),
    };
    match app.try_state::<Db>() {
        Some(state) => {
            if let Ok(conn) = state.0.lock() {
                let _ = crate::resource::index::upsert(
                    &conn, resource_type, name, is_official, entry_file.as_deref(), size,
                );
            }
        }
        None => {
            let _ = log::write(app, &log::LogSource::Backend, "warn", "索引写入失败: 数据库 state 未就绪");
        }
    }
}

/// 列举指定类型下所有已安装的资源
/// 直接读 SQLite 索引表, 不遍历磁盘文件夹, 秒回.
/// invoke("list_resources", { resourceType: "live2d" })
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    /// 资源名称 (等同模型目录名 / id, 用于定位)
    pub name: String,
    pub size: u64,
    /// 入口文件 (相对模型目录), 例如 "arg-nori.model3.json"
    #[serde(rename = "entryFile")]
    pub entry_file: Option<String>,
    /// 是否为官方模型 (下载来源 = true, 用户导入 = false)
    #[serde(rename = "isOfficial")]
    pub is_official: bool,
    /// 模型展示图标 (相对模型目录的图片路径, 来自模型配置顶层 image, 缺失为 None)
    #[serde(rename = "image")]
    pub image: Option<String>,
    /// 模型显示名称 (来自模型配置顶层 name; 缺失/为空时回落模型 id/目录名)
    #[serde(rename = "modelName")]
    pub model_name: Option<String>,
}

#[tauri::command]
pub fn list_resources(
    app: tauri::AppHandle,
    state: State<'_, Db>,
    resource_type: String,
) -> Result<Vec<ResourceSummary>, String> {
    let resource_type = parse_resource_type(&resource_type)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let indexed = crate::resource::index::list(&conn, resource_type).map_err(|e| e.to_string())?;
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("列出资源: type={} count={}", resource_type.as_str(), indexed.len()),
    );
    Ok(indexed
        .into_iter()
        .map(|r| {
            // 展示元信息来自模型级配置 (model.config.json 顶层), 读取失败/缺失时回落, 不影响列表
            let cfg = crate::resource::live2d::read_model_config(&data_dir, &r.name).ok();
            let image = cfg
                .as_ref()
                .map(|c| c.image.clone())
                .filter(|value| !value.is_empty());
            // 模型显示名称: 配置顶层 name, 缺失/为空时回落模型 id/目录名
            let model_name = cfg
                .as_ref()
                .map(|c| c.name.clone())
                .filter(|value| !value.is_empty())
                .or_else(|| Some(r.name.clone()));
            ResourceSummary {
                name: r.name,
                size: r.size,
                entry_file: r.entry_file,
                is_official: r.is_official,
                image,
                model_name,
            }
        })
        .collect())
}

/// 删除指定已安装资源 (磁盘 + 索引)
/// invoke("delete_resource", { resourceType: "live2d", name: "arg-nori" })
#[tauri::command]
pub fn delete_resource(
    state: State<'_, Db>,
    app: tauri::AppHandle,
    resource_type: String,
    name: String,
) -> Result<(), String> {
    let resource_type = parse_resource_type(&resource_type)?;
    let name = validate_resource_name(&name)?;
    crate::resource::delete(&app, resource_type, name)?;
    // 删除索引
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let _ = crate::resource::index::remove(&conn, resource_type, name);
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("删除资源: type={} name={}", resource_type.as_str(), name),
    );
    Ok(())
}

/// 导入 Live2D 模型 (async)
/// 前端先用 tauri-plugin-dialog 选择目录, 再把路径传给此命令:
/// 校验入口 → 复制到 resources/live2d/<id> → 写索引 → 通过 resource-import 事件推送进度
/// invoke("import_live2d", { sourcePath: "C:/xxx/model" })
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedResource {
    pub name: String,
    pub size: u64,
    pub entry_file: Option<String>,
}

#[tauri::command]
pub async fn import_live2d(
    app: tauri::AppHandle,
    source_path: String,
    source_type: String,
) -> Result<ImportedResource, String> {
    const EVENT: &str = "resource-import";
    let source = std::path::PathBuf::from(&source_path);

    // 归一化导入类型: dir(文件夹) / zip(压缩包) / model(单个入口 json)
    let kind = match source_type.as_str() {
        "dir" | "folder" => "dir",
        "zip" => "zip",
        "model" | "json" => "model",
        other => return Err(format!("不支持的导入类型: {other}")),
    };
    if !source.exists() {
        return Err(format!("所选路径不存在: {source_path}"));
    }
    match kind {
        "dir" if !source.is_dir() => return Err("导入模型文件夹需要选择目录".to_string()),
        "zip" if !source.is_file() => return Err("导入模型 zip 需要选择 .zip 文件".to_string()),
        "model" if !source.is_file() => return Err("导入入口文件需要选择 .json 文件".to_string()),
        _ => {}
    }

    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let temp_dir = crate::resource::temp_dir(&app).map_err(|e| e.to_string())?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("开始导入 Live2D: source={source_path} type={kind}"),
    );
    emit_resource_event(&app, EVENT, "live2d", "importing", Some(0.0), Some(0), None, None);

    // 准备/复制/解压耗时 → spawn_blocking, 进度靠事件
    let work_app = app.clone();
    let work_data = data_dir.clone();
    let work_temp = temp_dir.clone();
    let work_source = source.clone();
    let work_kind = kind.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let progress_app = work_app.clone();
        let progress_callback = move |total: u64, copied: u64| {
            let percent = if total > 0 {
                Some((copied as f64 / total as f64 * 100.0).min(100.0) as f32)
            } else {
                None
            };
            emit_resource_event(
                &progress_app, EVENT, "live2d", "importing", percent, Some(copied), Some(total), None,
            );
        };

        // 由导入类型解析出"就绪的源目录"与需清理的临时目录
        let mut cleanup_dir: Option<std::path::PathBuf> = None;
        let result = (|| {
            match work_kind.as_str() {
                "dir" => crate::resource::live2d::import_from_dir(&work_data, &work_source, progress_callback),
                "model" => {
                    // 单入口 json: 以其所在目录为源 (连同配套资产一起导入)
                    let parent = work_source
                        .parent()
                        .ok_or_else(|| "无法获取入口文件所在目录".to_string())?;
                    crate::resource::live2d::import_from_dir(&work_data, parent, progress_callback)
                }
                // zip: 解压到临时目录后按模型根平铺导入, 结束后清理
                "zip" => {
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_nanos())
                        .unwrap_or(0);
                    let unzip_dir = work_temp.join(format!("live2d_import_{stamp}"));
                    crate::resource::downloader::extract_zip(&work_source, &unzip_dir)
                        .map_err(|e| e.to_string())?;
                    cleanup_dir = Some(unzip_dir.clone());
                    crate::resource::live2d::import_from_dir(&work_data, &unzip_dir, progress_callback)
                }
                _ => Err(format!("不支持的导入类型: {work_kind}")),
            }
        })();

        match result {
            Ok(info) => {
                record_index(&work_app, ResourceType::Live2D, &info.name, false);
                emit_resource_event(&work_app, EVENT, "live2d", "done", Some(100.0), None, None, None);
                let _ = log::write(
                    &work_app,
                    &log::LogSource::Backend,
                    "info",
                    &format!("导入完成: name={} size={}", info.name, info.size),
                );
            }
            Err(error) => {
                let _ = log::write(
                    &work_app,
                    &log::LogSource::Backend,
                    "error",
                    &format!("导入 Live2D 失败: {error}"),
                );
                emit_resource_event(&work_app, EVENT, "live2d", "error", None, None, None, Some(error));
            }
        }
        // 清理 zip 解压的临时目录
        if let Some(dir) = cleanup_dir {
            let _ = std::fs::remove_dir_all(&dir);
        }
    });

    // 立即返回占位 (真正的导入结果通过 resource-import 事件告知前端)
    Ok(ImportedResource {
        name: String::new(),
        size: 0,
        entry_file: None,
    })
}

/// 发送资源进度事件到前端
/// `event_name` 区分 `resource-download` 与 `resource-import`
fn emit_resource_event(
    app: &tauri::AppHandle,
    event_name: &str,
    resource_type: &str,
    step: &str,
    progress: Option<f32>,
    processed: Option<u64>,
    total: Option<u64>,
    message: Option<String>,
) {
    let event = ResourceProgressEvent {
        resource_type: resource_type.to_string(),
        step: step.to_string(),
        progress,
        processed,
        total,
        message,
    };
    if let Err(error) = app.emit(event_name, event) {
        let _ = log::write(
            app,
            &log::LogSource::Backend,
            "warn",
            &format!("发送资源事件失败: {error}"),
        );
    }
}

/// 读取模型级配置 (渲染配置 + 自定义可触摸区域)
/// 文件缺失时返回默认配置, 不报错.
/// invoke("read_model_config", { name: "ARGNori" })
#[tauri::command]
pub fn read_model_config(
    app: tauri::AppHandle,
    name: String,
) -> Result<crate::resource::live2d::ModelConfig, String> {
    let name = validate_resource_name(&name)?;
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let config = crate::resource::live2d::read_model_config(&data_dir, name)?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("读取模型配置: name={name} touches={}", config.touches.len()),
    );
    Ok(config)
}

/// 写入模型级配置 (渲染配置 + 自定义可触摸区域)
/// invoke("write_model_config", { name: "ARGNori", config: {...} })
#[tauri::command]
pub fn write_model_config(
    app: tauri::AppHandle,
    name: String,
    config: crate::resource::live2d::ModelConfig,
) -> Result<(), String> {
    let name = validate_resource_name(&name)?;
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    crate::resource::live2d::write_model_config(&data_dir, name, &config)?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("写入模型配置: name={name} touches={}", config.touches.len()),
    );
    Ok(())
}

/// 将用户选择的图片复制进模型目录作为模型封面
/// 返回相对模型目录的路径 (如 `cover.png`), 前端应随后写入配置的 image 字段
/// invoke("save_model_cover", { name: "arg-nori", sourcePath: "C:/xx/logo.png" })
#[tauri::command]
pub fn save_model_cover(
    app: tauri::AppHandle,
    name: String,
    source_path: String,
) -> Result<String, String> {
    let name = validate_resource_name(&name)?;
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let relative = crate::resource::live2d::save_model_image(
        &data_dir,
        name,
        std::path::Path::new(&source_path),
    )?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("保存模型封面: name={name} <- {source_path} -> {relative}"),
    );
    Ok(relative)
}

/// 导出模型级配置到指定路径 (原样复制 model.config.json 文本)
/// 前端先用 `save` 对话框拿到目标文件路径 (默认名为<模型显示名>.config.json), 再传入.
/// invoke("export_model_config", { name: "ARGNori", targetPath: "C:/xx/哼.config.json" })
#[tauri::command]
pub fn export_model_config(
    app: tauri::AppHandle,
    name: String,
    target_path: String,
) -> Result<(), String> {
    let name = validate_resource_name(&name)?;
    let target = std::path::PathBuf::from(&target_path);
    // 目标路径不能渲染为目录
    if target.is_dir() {
        return Err("导出目标不能是目录".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!("导出目录不存在: {}", parent.display()));
        }
    }
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let source = crate::resource::live2d::model_config_path(&data_dir, name)?;
    if !source.is_file() {
        return Err(format!("模型没有配置文件: {name}"));
    }
    let content = std::fs::read_to_string(&source)
        .map_err(|e| format!("读取模型配置失败: {e}"))?;
    std::fs::write(&target, content).map_err(|e| format!("写入导出文件失败: {e}"))?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("导出模型配置: name={name} -> {}", target.display()),
    );
    Ok(())
}

/// 导入模型级配置到指定模型 (读取源文件, 校验 JSON 合法后写为 model.config.json)
/// 前端先用 `open` 对话框选中配置文件, 再传入 sourcePath 与目标模型名.
/// invoke("import_model_config", { name: "ARGNori", sourcePath: "C:/xx/导出.config.json" })
#[tauri::command]
pub fn import_model_config(
    app: tauri::AppHandle,
    name: String,
    source_path: String,
) -> Result<(), String> {
    let name = validate_resource_name(&name)?;
    let source = std::path::PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("所选文件不存在".to_string());
    }
    let content = std::fs::read_to_string(&source)
        .map_err(|e| format!("读取所选文件失败: {e}"))?;
    // 按 ModelConfig 结构校验: 保证导入后能被正常反序列化读取
    // (字段带 default, 合法 JSON 即使缺字段也不丢, 结构错误则拒绝导入避免配置整体失效)
    serde_json::from_str::<crate::resource::live2d::ModelConfig>(&content)
        .map_err(|e| format!("文件不是合法的模型配置文件: {e}"))?;
    let data_dir = db::data_dir(&app).map_err(|e| e.to_string())?;
    let target = crate::resource::live2d::model_config_path(&data_dir, name)?;
    let parent = target.parent().ok_or("模型目录不存在")?;
    if !parent.is_dir() {
        return Err(format!("Live2D 资源不存在: {name}"));
    }
    std::fs::write(&target, &content).map_err(|e| format!("写入模型配置失败: {e}"))?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("导入模型配置: {name} <- {}", source.display()),
    );
    Ok(())
}
