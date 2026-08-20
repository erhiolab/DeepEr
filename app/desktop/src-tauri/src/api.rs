//! 后端 API 客户端模块
//!
//! 集中管理对后端网关的所有 HTTP 请求:
//! - 公共基础地址 [`API_BASE_URL`](https://api.elake.top/deeper)
//! - 统一响应结构 [`ApiResponse`]
//! - 各业务接口 (`/live2d/list`、`/resource/download_url` 等)
//!
//! 网络请求尽量使用 async 版本 (供 Tauri async 命令调用, 不会阻塞渲染线程);
//! 下载流程沿用 blocking (跑在 spawn_blocking 中).

use serde::de::DeserializeOwned;

/// API 基础地址
pub const API_BASE_URL: &str = "https://api.elake.top/deeper";
/// 后端接口路径
pub mod path {
    /// 获取资源下载地址
    pub const RESOURCE_DOWNLOAD_URL: &str = "/resource/download_url";
    /// 获取 Live2D 模型列表
    pub const LIVE2D_LIST: &str = "/live2d/list";
    /// 获取 Live2D 模型封面图
    pub const LIVE2D_COVER: &str = "/live2d/cover";
}

/// Live2D 模型摘要 (来自 `/live2d/list`)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2dSummary {
    /// 模型 ID
    pub id: String,
    /// 模型名称
    pub name: String,
    /// 模型封面图 URL (指向网关 /live2d/cover, 由浏览器缓存)
    #[serde(rename = "coverUrl", default)]
    pub cover_url: String,
}

/// 后端统一响应结构
/// `{ error, message, body, timestamp }`
#[derive(Debug, serde::Deserialize)]
pub struct ApiResponse<T> {
    /// 业务数据
    pub body: Option<T>,
    /// 是否业务出错
    pub error: bool,
    /// 错误信息
    pub message: String,
    /// 响应时间戳 (毫秒)
    #[allow(dead_code)]
    pub timestamp: i64,
}

impl<T> ApiResponse<T> {
    /// 检查业务错误并取出 `body`
    pub fn into_body(self) -> Result<T, ApiError> {
        if self.error {
            let message = if self.message.is_empty() {
                "接口返回错误".to_string()
            } else {
                self.message
            };
            return Err(ApiError::Business(message));
        }
        self.body
            .ok_or_else(|| ApiError::InvalidResponse("接口响应中缺少 body".to_string()))
    }
}

/// API 错误
#[derive(Debug)]
pub enum ApiError {
    /// 网络请求失败
    Request(String),
    /// 接口返回非成功状态码
    Http(u16),
    /// 响应解析失败或结构不符合预期
    InvalidResponse(String),
    /// 接口业务错误 (error = true)
    Business(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Request(message) => write!(f, "网络错误: {message}"),
            Self::Http(status) => write!(f, "接口返回错误: HTTP {status}"),
            Self::InvalidResponse(message) => write!(f, "解析接口响应失败: {message}"),
            Self::Business(message) => write!(f, "接口返回错误: {message}"),
        }
    }
}

impl std::error::Error for ApiError {}

/// `/live2d/list` 的 body 结构
#[derive(Debug, serde::Deserialize)]
struct Live2dListBody {
    list: Vec<Live2dSummary>,
}

/// 请求 `/live2d/list`, 获取线上 Live2D 模型列表
/// async 版本, 不阻塞渲染线程.
pub async fn fetch_live2d_list_async() -> Result<Vec<Live2dSummary>, ApiError> {
    let url = format!("{API_BASE_URL}{}", path::LIVE2D_LIST);
    let response: ApiResponse<Live2dListBody> = get_async(&url, &[]).await?;
    let mut list = response.into_body()?.list;
    // 为每个模型补充封面图 URL (指向网关 /live2d/cover, 浏览器缓存)
    for item in &mut list {
        item.cover_url = format!(
            "{API_BASE_URL}{}?id={}",
            path::LIVE2D_COVER,
            urlencode(&item.id)
        );
    }
    Ok(list)
}

/// `/resource/download_url` 的 body 结构
#[derive(Debug, serde::Deserialize)]
struct DownloadUrlBody {
    url: String,
}

/// 请求 `/resource/download_url`, 获取资源的签名下载地址
pub fn fetch_download_url(resource_type: &str, name: &str) -> Result<String, ApiError> {
    let url = format!("{API_BASE_URL}{}", path::RESOURCE_DOWNLOAD_URL);
    let response: ApiResponse<DownloadUrlBody> =
        get(&url, &[("type", resource_type), ("name", name)])?;
    Ok(response.into_body()?.url)
}

/// 拉取 OpenAI-compatible `/models` (LLM 模型列表)
/// 注意: 这是用户自配的第三方接口, 不走 [`API_BASE_URL`]
/// async 版本, 不阻塞渲染线程.
pub async fn fetch_llm_models_async(base_url: &str, api_key: &str) -> Result<Vec<String>, ApiError> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| ApiError::Request(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::Http(status.as_u16()));
    }
    parse_model_list(response.json().await.map_err(|e| ApiError::InvalidResponse(e.to_string()))?)
}

/// 发起 GET 请求并解析为 JSON (blocking)
/// 供下载流程使用, 运行在 spawn_blocking 中
fn get<T>(url: &str, query: &[(&str, &str)]) -> Result<T, ApiError>
where
    T: DeserializeOwned,
{
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| ApiError::Request(e.to_string()))?;
    let mut request = client.get(url);
    if !query.is_empty() {
        request = request.query(query);
    }
    let response = request
        .send()
        .map_err(|e| ApiError::Request(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::Http(status.as_u16()));
    }
    response
        .json()
        .map_err(|e| ApiError::InvalidResponse(e.to_string()))
}

/// 发起 GET 请求并解析为 JSON (async)
/// 供 Tauri async 命令调用, 不阻塞渲染线程
async fn get_async<T>(url: &str, query: &[(&str, &str)]) -> Result<T, ApiError>
where
    T: DeserializeOwned,
{
    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if !query.is_empty() {
        request = request.query(query);
    }
    let response = request
        .send()
        .await
        .map_err(|e| ApiError::Request(e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(ApiError::Http(status.as_u16()));
    }
    response
        .json()
        .await
        .map_err(|e| ApiError::InvalidResponse(e.to_string()))
}

/// 从 OpenAI-compatible `/models` 响应中解析模型 id 列表
fn parse_model_list(body: serde_json::Value) -> Result<Vec<String>, ApiError> {
    let data = body
        .get("data")
        .and_then(|value| value.as_array())
        .ok_or_else(|| ApiError::InvalidResponse("接口返回成功, 但缺少 data 字段".to_string()))?;
    let mut models = Vec::with_capacity(data.len());
    for item in data {
        if let Some(id) = item.as_str() {
            models.push(id.to_string());
            continue;
        }
        if let Some(id) = item.get("id").and_then(|value| value.as_str()) {
            models.push(id.to_string());
        }
    }
    models.sort();
    models.dedup();
    if models.is_empty() {
        return Err(ApiError::InvalidResponse(
            "接口返回成功, 但没有解析到任何模型".to_string(),
        ));
    }
    Ok(models)
}

/// 对查询参数值做 URL 百分号编码 (仅转义非 URL-安全字符, 零第三方依赖)
/// 模型 ID 通常为字母数字, 此函数主要用于防御空格/中文等特殊字符.
fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
