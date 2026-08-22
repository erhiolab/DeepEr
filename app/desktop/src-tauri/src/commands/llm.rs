//! LLM 相关命令

use std::collections::HashMap;

use reqwest::Client;
use reqwest::Method;

/// LLM 通用 HTTP 转发结果
/// 只要请求有 HTTP 响应(无论 2xx/4xx/5xx)都返回 Ok, 由前端按状态码解释;
/// 仅当网络层失败(连接被拒 / 超时 / 无响应)时返回 Err.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmHttpResponse {
    /// HTTP 状态码 (如 200 / 401 / 500)
    pub status: u16,
    /// 解析后的 JSON 响应体 (非 JSON 时为空对象)
    pub body: serde_json::Value,
}

/// 发起一次通用 LLM HTTP 请求
/// 与具体适配器协议解耦: 前端按当前平台组装 url / method / headers / body,
/// 后端只负责转发并返回 status + JSON body, 新增平台无需改动后端.
///
/// invoke("llm_http_request", {
///   url: "https://api.openai.com/v1/responses",
///   method: "POST",
///   headers: { "Authorization": "Bearer sk-..." },
///   body: { model: "gpt-4o-mini", input: [...] },
///   timeoutMs: 20000,   // 可选, 默认 20s
/// })
#[tauri::command]
pub async fn llm_http_request(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
) -> Result<LlmHttpResponse, String> {
    let parsed_method = Method::from_bytes(method.as_deref().unwrap_or("POST").as_bytes())
        .map_err(|e| format!("非法 HTTP 方法: {e}"))?;
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(20_000));
    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let mut request = client.request(parsed_method, &url);
    if let Some(h) = headers {
        for (key, value) in h {
            request = request.header(&key, &value);
        }
    }
    if let Some(b) = body {
        request = request.json(&b);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("无法连接 {url}: {e}"))?;
    let status = response.status().as_u16();
    // 任何非 JSON / 空响应都回落为空对象, 交由前端按平台结构解读
    let parsed: serde_json::Value =
        response.json().await.unwrap_or(serde_json::Value::Null);
    Ok(LlmHttpResponse {
        status,
        body: parsed,
    })
}
