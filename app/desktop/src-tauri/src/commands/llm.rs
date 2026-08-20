//! LLM 相关命令

use crate::log;

/// 拉取 OpenAI-compatible /models
/// async 命令, 不阻塞渲染线程.
/// invoke("fetch_llm_models", {
///   baseUrl: "https://api.openai.com/v1",
///   apiKey: "sk-..."
/// })
#[tauri::command]
pub async fn fetch_llm_models(
    app: tauri::AppHandle,
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    let models =
        crate::api::fetch_llm_models_async(&base_url, &api_key).await.map_err(|error| {
            let _ = log::write(
                &app,
                &log::LogSource::Backend,
                "error",
                &format!("拉取模型失败: {error}"),
            );
            error.to_string()
        })?;
    let _ = log::write(
        &app,
        &log::LogSource::Backend,
        "info",
        &format!("拉取模型成功, 共 {} 个", models.len()),
    );
    Ok(models)
}
