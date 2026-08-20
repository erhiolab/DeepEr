//! Live2D 线上列表命令

use crate::api::Live2dSummary;
use crate::log;

/// 拉取后端网关的 Live2D 模型列表 (GET {API_BASE_URL}/live2d/list)
/// async 命令, 不阻塞渲染线程.
/// invoke("fetch_live2d_list")
/// 返回: [{ id, name }, ...]
#[tauri::command]
pub async fn fetch_live2d_list(app: tauri::AppHandle) -> Result<Vec<Live2dSummary>, String> {
    let list = crate::api::fetch_live2d_list_async().await.map_err(|error| {
        let _ = log::write(
            &app,
            &log::LogSource::Backend,
            "error",
            &format!("拉取 Live2D 模型列表失败: {error}"),
        );
        error.to_string()
    })?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("拉取 Live2D 模型列表成功, 共 {} 个", list.len()),
    );
    Ok(list)
}
