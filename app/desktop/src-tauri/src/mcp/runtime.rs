//! MCP 运行时: 连接外部 MCP 服务器, 把它的工具同步进 tools 表 (provider=mcp), 并转发 Agent 的工具调用.
//!
//! 传输支持:
//! - `stdio`          : 启动本地进程 (npx / uvx / 可执行文件) 走 stdin/stdout
//! - `sse`            : 传统 MCP SSE 传输 (GET ?event 流 + POST 消息端点)
//! - `http`           : Streamable HTTP 传输 (新规范)
//!
//! 连接按服务器 id 缓存复用, 配置变化 (updated_at 指纹) 或进程退出后自动重连.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::TryFutureExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use rmcp::model::{
	CallToolRequestParams, CallToolResult, ClientJsonRpcMessage, Content, RawContent,
	ResourceContents, ServerJsonRpcMessage, Tool as McpTool,
};
use rmcp::service::RunningService;
use rmcp::transport::streamable_http_client::{
	StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::transport::{TokioChildProcess, Transport};
use rmcp::{Peer, RoleClient, serve_client};
use rusqlite::Connection;
use serde_json::{json, Value};
use sse_stream::SseStream;
use tauri::{AppHandle, Manager};

use crate::db;
use crate::log::{self, LogSource};
use crate::mcp::model::McpServerRecord;
use crate::mcp::repository as mcp_repository;
use crate::tool::repository as tool_repository;

/// 连接握手超时
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// 获取工具列表超时
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// 单次工具调用超时
const CALL_TIMEOUT: Duration = Duration::from_secs(90);

// ---------------------------------------------------------------------------
// 传输层
// ---------------------------------------------------------------------------

/// 统一的传输错误 (具体类型, 满足 Transport::Error 的 Error + Send + Sync 约束)
#[derive(Debug)]
pub struct McpError(pub String);

impl std::fmt::Display for McpError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

impl std::error::Error for McpError {}

impl From<String> for McpError {
	fn from(value: String) -> Self {
		McpError(value)
	}
}

impl From<&str> for McpError {
	fn from(value: &str) -> Self {
		McpError(value.to_string())
	}
}

impl From<reqwest::Error> for McpError {
	fn from(value: reqwest::Error) -> Self {
		McpError(value.to_string())
	}
}

impl From<serde_json::Error> for McpError {
	fn from(value: serde_json::Error) -> Self {
		McpError(value.to_string())
	}
}

/// 统一三种传输的枚举 (serve_client 需要具体类型)
enum McpTransport {
	Stdio(TokioChildProcess),
	Http(StreamableHttpClientTransport<reqwest_mcp::Client>),
	Sse(SseTransport),
}

impl Transport<RoleClient> for McpTransport {
	type Error = McpError;

	fn send(&mut self, item: ClientJsonRpcMessage) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
		let future: Pin<Box<dyn Future<Output = Result<(), Self::Error>> + Send + 'static>> = match self {
			McpTransport::Stdio(t) => Box::pin(t.send(item).map_err(|e| McpError(e.to_string()))),
			McpTransport::Http(t) => Box::pin(t.send(item).map_err(|e| McpError(e.to_string()))),
			McpTransport::Sse(t) => Box::pin(t.send(item)),
		};
		future
	}

	fn receive(&mut self) -> impl Future<Output = Option<ServerJsonRpcMessage>> + Send {
		let future: Pin<Box<dyn Future<Output = Option<ServerJsonRpcMessage>> + Send + '_>> = match self {
			McpTransport::Stdio(t) => Box::pin(t.receive()),
			McpTransport::Http(t) => Box::pin(t.receive()),
			McpTransport::Sse(t) => Box::pin(t.receive()),
		};
		future
	}

	fn close(&mut self) -> impl Future<Output = Result<(), Self::Error>> + Send {
		let future: Pin<Box<dyn Future<Output = Result<(), Self::Error>> + Send + '_>> = match self {
			McpTransport::Stdio(t) => Box::pin(t.close().map_err(|e| McpError(e.to_string()))),
			McpTransport::Http(t) => Box::pin(t.close().map_err(|e| McpError(e.to_string()))),
			McpTransport::Sse(t) => Box::pin(t.close()),
		};
		future
	}
}

/// 构造 stdio 传输 (启动子进程, 接管 stdin/stdout)
fn build_stdio_transport(server: &McpServerRecord) -> Result<TokioChildProcess, String> {
	let command = server.command.trim();
	if command.is_empty() {
		return Err("stdio 传输缺少启动命令".to_string());
	}
	let mut cmd = tokio::process::Command::new(command);
	if let Some(args) = server.args.as_array() {
		for arg in args {
			if let Some(s) = arg.as_str() {
				cmd.arg(s);
			}
		}
	}
	if let Some(env) = server.env.as_object() {
		for (key, value) in env {
			if let Some(v) = value.as_str() {
				cmd.env(key, v);
			}
		}
	}
	cmd.stdin(std::process::Stdio::piped());
	cmd.stdout(std::process::Stdio::piped());
	cmd.stderr(std::process::Stdio::inherit());
	TokioChildProcess::new(cmd).map_err(|e| format!("启动 MCP 进程失败: {e}"))
}

/// 把 headers (JSON 对象) 转成 reqwest HeaderMap; Authorization: Bearer xxx 走 auth_header
fn parse_headers(value: &Value) -> Result<(Option<String>, HashMap<HeaderName, HeaderValue>), String> {
	let mut auth: Option<String> = None;
	let mut headers: HashMap<HeaderName, HeaderValue> = HashMap::new();
	if let Some(obj) = value.as_object() {
		for (key, value) in obj {
			let Some(raw) = value.as_str() else { continue };
			if key.eq_ignore_ascii_case("authorization") {
				auth = Some(
					raw.strip_prefix("Bearer ")
						.unwrap_or(raw)
						.trim()
						.to_string(),
				);
				continue;
			}
			let name = HeaderName::from_bytes(key.as_bytes())
				.map_err(|e| format!("无效请求头 {key}: {e}"))?;
			let header_value = HeaderValue::from_str(raw)
				.map_err(|e| format!("无效请求头值 {key}: {e}"))?;
			headers.insert(name, header_value);
		}
	}
	Ok((auth, headers))
}

/// 构造 Streamable HTTP 传输
fn build_http_transport(server: &McpServerRecord) -> Result<StreamableHttpClientTransport<reqwest_mcp::Client>, String> {
	let url = server.url.trim();
	if url.is_empty() {
		return Err("http 传输缺少服务器地址".to_string());
	}
	let mut config = StreamableHttpClientTransportConfig::with_uri(url);
	let (auth, headers) = parse_headers(&server.headers)?;
	if let Some(token) = auth {
		config = config.auth_header(token);
	}
	if !headers.is_empty() {
		config = config.custom_headers(headers);
	}
	Ok(StreamableHttpClientTransport::with_client(
		reqwest_mcp::Client::new(),
		config,
	))
}

/// 传统 MCP SSE 传输:
/// - 后台 GET `{url}?event` 打开 SSE 流, 先收 `endpoint` 事件拿到消息端点
/// - `send` 向消息端点 POST JSON-RPC, 响应通过 SSE 流的 `message` 事件回传
struct SseTransport {
	client: reqwest::Client,
	headers: HeaderMap,
	endpoint_rx: tokio::sync::watch::Receiver<Option<Result<String, String>>>,
	rx: tokio::sync::mpsc::Receiver<ServerJsonRpcMessage>,
	cancel_tx: tokio::sync::watch::Sender<bool>,
}

impl SseTransport {
	fn new(server: &McpServerRecord) -> Result<Self, String> {
		let url = server.url.trim().to_string();
		if url.is_empty() {
			return Err("sse 传输缺少服务器地址".to_string());
		}
		let (_, raw_headers) = parse_headers(&server.headers)?;
		let mut headers = HeaderMap::new();
		for (name, value) in raw_headers {
			headers.append(name, value);
		}
		let client = reqwest::Client::builder()
			.timeout(Duration::from_secs(60))
			.build()
			.map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

		let (endpoint_tx, endpoint_rx) = tokio::sync::watch::channel(None);
		let (msg_tx, msg_rx) = tokio::sync::mpsc::channel(64);
		let cancel_tx = tokio::sync::watch::channel(false).0;

		let task_client = client.clone();
		let task_headers = headers.clone();
		let task_url = url.clone();
		let task_endpoint_tx = endpoint_tx.clone();
		let mut task_cancel_rx = cancel_tx.subscribe();
		tokio::spawn(async move {
			let stream_url = if task_url.contains('?') {
				format!("{task_url}&event")
			} else {
				format!("{task_url}?event")
			};
			let response = match task_client
				.get(&stream_url)
				.header(ACCEPT, "text/event-stream")
				.headers(task_headers.clone())
				.send()
				.await
			{
				Ok(response) => response,
				Err(e) => {
					let _ = task_endpoint_tx.send(Some(Err(format!("SSE 连接失败: {e}"))));
					return;
				}
			};
			let response = match response.error_for_status() {
				Ok(response) => response,
				Err(e) => {
					let _ = task_endpoint_tx.send(Some(Err(format!("SSE 连接失败: {e}"))));
					return;
				}
			};
			let mut stream = SseStream::from_bytes_stream(response.bytes_stream());
			loop {
				tokio::select! {
					changed = task_cancel_rx.changed() => {
						let _ = changed;
						break;
					}
					next = stream.next() => {
						let Some(ev) = next else { break };
						let Ok(ev) = ev else { break };
						let Some(data) = ev.data else { continue };
						let data = data.trim();
						match ev.event.as_deref() {
							Some("endpoint") => {
								let _ = task_endpoint_tx.send(Some(Ok(data.to_string())));
							}
							Some("message") => {
								if let Ok(msg) = serde_json::from_str::<ServerJsonRpcMessage>(data) {
									if msg_tx.send(msg).await.is_err() {
										break;
									}
								}
							}
							None => {
								if data.starts_with("http://") || data.starts_with("https://") {
									let _ = task_endpoint_tx.send(Some(Ok(data.to_string())));
								} else if let Ok(msg) = serde_json::from_str::<ServerJsonRpcMessage>(data) {
									if msg_tx.send(msg).await.is_err() {
										break;
									}
								}
							}
							_ => {}
						}
					}
				}
			}
		});

		Ok(Self {
			client,
			headers,
			endpoint_rx,
			rx: msg_rx,
			cancel_tx,
		})
	}
}

impl Transport<RoleClient> for SseTransport {
	type Error = McpError;

	fn send(&mut self, item: ClientJsonRpcMessage) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
		let client = self.client.clone();
		let headers = self.headers.clone();
		let mut endpoint_rx = self.endpoint_rx.clone();
		async move {
			let body = serde_json::to_string(&item)?;
			let endpoint = loop {
				if let Some(Ok(url)) = endpoint_rx.borrow().as_ref() {
					break url.clone();
				}
				if let Some(Err(err)) = endpoint_rx.borrow().as_ref() {
					return Err(McpError(err.clone()));
				}
				if endpoint_rx.changed().await.is_err() {
					return Err(McpError("SSE 连接已关闭 (未收到 endpoint)".to_string()));
				}
			};
			let response = client
				.post(&endpoint)
				.header(CONTENT_TYPE, "application/json")
				.headers(headers)
				.body(body)
				.send()
				.await?;
			response.error_for_status()?;
			Ok(())
		}
	}

	fn receive(&mut self) -> impl Future<Output = Option<ServerJsonRpcMessage>> + Send {
		self.rx.recv()
	}

	fn close(&mut self) -> impl Future<Output = Result<(), Self::Error>> + Send {
		let _ = self.cancel_tx.send(true);
		async move { Ok(()) }
	}
}

// ---------------------------------------------------------------------------
// 连接缓存
// ---------------------------------------------------------------------------

/// 配置指纹: 传输/命令/参数/地址/请求头/环境变量/启停 + 更新时间
fn server_fingerprint(server: &McpServerRecord) -> String {
	format!(
		"{}|{}|{}|{}|{}|{}|{}|{}",
		server.transport,
		server.command,
		server.args,
		server.url,
		server.headers,
		server.env,
		server.enabled,
		server.updated_at
	)
}

/// 一条存活连接 (peer 可克隆, RunningService 保活)
struct McpConnection {
	fingerprint: String,
	peer: Peer<RoleClient>,
	_running: RunningService<RoleClient, ()>,
}

impl McpConnection {
	fn is_closed(&self) -> bool {
		self._running.is_closed()
	}
}

/// 连接并完成 MCP 握手
async fn connect(server: &McpServerRecord) -> Result<McpConnection, String> {
	let transport = match server.transport.as_str() {
		"stdio" => McpTransport::Stdio(build_stdio_transport(server)?),
		"sse" => McpTransport::Sse(SseTransport::new(server)?),
		"http" | "streamable-http" => McpTransport::Http(build_http_transport(server)?),
		other => return Err(format!("不支持的 MCP 传输方式: {other}")),
	};
	let running = tokio::time::timeout(CONNECT_TIMEOUT, serve_client((), transport))
		.await
		.map_err(|_| format!("连接 MCP 服务器「{}」超时", server.name))?
		.map_err(|e| format!("MCP 握手失败: {e}"))?;
	let peer = running.peer().clone();
	Ok(McpConnection {
		fingerprint: server_fingerprint(server),
		peer,
		_running: running,
	})
}

/// 进程级运行时: 按服务器 id 缓存连接
pub struct McpRuntime {
	connections: tokio::sync::Mutex<HashMap<i64, Arc<McpConnection>>>,
}

static MCP_RUNTIME: std::sync::OnceLock<McpRuntime> = std::sync::OnceLock::new();

impl McpRuntime {
	fn global() -> &'static McpRuntime {
		MCP_RUNTIME.get_or_init(|| McpRuntime {
			connections: tokio::sync::Mutex::new(HashMap::new()),
		})
	}

	/// 获取 (或建立) 服务器连接; 配置变更 / 进程退出时自动重连
	async fn get_connection(&self, server: &McpServerRecord) -> Result<Arc<McpConnection>, String> {
		let mut map = self.connections.lock().await;
		if let Some(existing) = map.get(&server.id) {
			if existing.fingerprint == server_fingerprint(server) && !existing.is_closed() {
				return Ok(existing.clone());
			}
		}
		let connection = Arc::new(connect(server).await?);
		map.insert(server.id, connection.clone());
		Ok(connection)
	}

	/// 关闭某服务器的缓存连接 (配置/启用状态变化或删除时调用)
	async fn close_server(&self, id: i64) {
		self.connections.lock().await.remove(&id);
	}
}

// ---------------------------------------------------------------------------
// 工具调用
// ---------------------------------------------------------------------------

/// 把 MCP call_tool 结果转成 Agent 可读的 JSON
fn format_tool_result(result: CallToolResult) -> Result<Value, String> {
	let text = content_to_text(&result.content);
	if result.is_error == Some(true) {
		return Err(if text.is_empty() {
			"MCP 工具执行失败".to_string()
		} else {
			text
		});
	}
	if let Some(structured) = result.structured_content {
		return Ok(structured);
	}
	if !text.is_empty() {
		return Ok(json!({ "text": text }));
	}
	Ok(json!({ "ok": true }))
}

fn content_to_text(content: &[Content]) -> String {
	let mut parts: Vec<String> = Vec::new();
	for item in content {
		match &item.raw {
			RawContent::Text(text) => parts.push(text.text.clone()),
			RawContent::Image(image) => parts.push(format!(
				"[image: {} 数据 {} 字节]",
				image.mime_type,
				image.data.len()
			)),
			RawContent::Resource(resource) => {
				let uri = match &resource.resource {
					ResourceContents::TextResourceContents { uri, .. } => uri.clone(),
					ResourceContents::BlobResourceContents { uri, .. } => uri.clone(),
				};
				parts.push(format!("[resource: {uri}]"));
			}
			RawContent::Audio(audio) => {
				parts.push(format!("[audio: {} 数据 {} 字节]", audio.mime_type, audio.data.len()));
			}
			RawContent::ResourceLink(link) => {
				parts.push(format!("[resource link: {}]", link.uri));
			}
		}
	}
	parts.join("\n")
}

/// 执行一次 MCP 工具调用 (由 Agent 循环 / 前端命令异步调用)
pub async fn execute_tool(app: &AppHandle, tool_name: &str, args: Value) -> Result<Value, String> {
	let state = app
		.try_state::<db::Db>()
		.ok_or_else(|| "数据库未就绪".to_string())?;
	let (server_id, mcp_tool) = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		let definition = tool_repository::get_by_name(&conn, tool_name)?
			.ok_or_else(|| format!("未找到工具「{tool_name}」"))?;
		let server_id = definition
			.config
			.get("serverId")
			.and_then(|v| v.as_i64())
			.ok_or_else(|| format!("工具「{tool_name}」缺少 MCP serverId"))?;
		let mcp_tool = definition
			.config
			.get("mcpTool")
			.and_then(|v| v.as_str())
			.map(|s| s.to_string())
			.ok_or_else(|| format!("工具「{tool_name}」缺少 MCP 工具名"))?;
		(server_id, mcp_tool)
	};
	let server = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		mcp_repository::get(&conn, server_id)?.ok_or_else(|| "MCP 服务器不存在".to_string())?
	};
	if !server.enabled {
		return Err(format!("MCP 服务器「{}」已禁用", server.name));
	}
	call_tool(&server, &mcp_tool, args).await
}

/// 向指定服务器调用 MCP 工具
async fn call_tool(server: &McpServerRecord, mcp_tool: &str, args: Value) -> Result<Value, String> {
	let connection = McpRuntime::global().get_connection(server).await?;
	let args_obj = args.as_object().cloned().unwrap_or_default();
	let params = CallToolRequestParams {
		meta: None,
		name: mcp_tool.to_string().into(),
		arguments: Some(args_obj),
		task: None,
	};
	let result = tokio::time::timeout(CALL_TIMEOUT, connection.peer.call_tool(params))
		.await
		.map_err(|_| format!("调用 MCP 工具超时: {mcp_tool}"))?
		.map_err(|e| format!("调用 MCP 工具失败: {e}"))?;
	format_tool_result(result)
}

// ---------------------------------------------------------------------------
// 工具同步 (tools 表)
// ---------------------------------------------------------------------------

/// 单次同步结果 (返回给前端展示)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
	pub server_id: i64,
	pub server_name: String,
	pub ok: bool,
	pub tool_count: usize,
	pub tools: Vec<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

/// 名字规范化: 只保留小写字母/数字/下划线, 其余转 `-` (保证可被 <tool_call name> 解析)
fn sanitize_name(input: &str) -> String {
	let mut out = String::new();
	let mut last_dash = false;
	for ch in input.chars() {
		if ch.is_ascii_alphanumeric() || ch == '_' {
			out.push(ch.to_ascii_lowercase());
			last_dash = false;
		} else if !last_dash && !out.is_empty() {
			out.push('-');
			last_dash = true;
		}
	}
	while out.ends_with('-') {
		out.pop();
	}
	if out.is_empty() {
		"tool".to_string()
	} else {
		out
	}
}

/// 工具名避免与内置/已有工具冲突 (如 `time-now`), 冲突时追加服务器 id
fn unique_tool_name(conn: &Connection, base: &str, server_id: i64) -> String {
	let exists: bool = conn
		.query_row("SELECT EXISTS(SELECT 1 FROM tools WHERE name = ?1)", [base], |row| row.get(0))
		.unwrap_or(false);
	if exists {
		format!("{base}-{server_id}")
	} else {
		base.to_string()
	}
}

/// 同步单个服务器: 连接 → 列出工具 → 全量写回 tools 表
pub async fn sync_server(app: &AppHandle, server: &McpServerRecord) -> Result<SyncSummary, String> {
	let connection = McpRuntime::global().get_connection(server).await?;
	let tools: Vec<McpTool> = tokio::time::timeout(LIST_TIMEOUT, connection.peer.list_all_tools())
		.await
		.map_err(|_| format!("获取「{}」工具列表超时", server.name))?
		.map_err(|e| format!("获取「{}」工具列表失败: {e}", server.name))?;

	let state = app
		.try_state::<db::Db>()
		.ok_or_else(|| "数据库未就绪".to_string())?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;

	let mut synced: Vec<(String, String)> = Vec::new();
	tool_repository::delete_mcp_tools_by_server(&conn, server.id)?;
	for tool in &tools {
		let mcp_name = tool.name.to_string();
		let title = tool.title.clone().unwrap_or_else(|| mcp_name.clone());
		let label = format!("{}-{}", server.name.trim(), title);
		let description = tool
			.description
			.as_deref()
			.map(|s| s.to_string())
			.unwrap_or_else(|| format!("MCP 工具({}): {}", server.name, mcp_name));
		let base_name = format!("{}-{}", sanitize_name(&server.name), sanitize_name(&mcp_name));
		let name = unique_tool_name(&conn, &base_name, server.id);
		let schema = Value::Object(tool.input_schema.as_ref().clone());
		let config = json!({
			"serverId": server.id,
			"serverName": server.name,
			"mcpTool": mcp_name,
		});
		tool_repository::upsert_mcp_tool(
			&conn,
			&name,
			&label,
			&description,
			&mcp_name,
			schema,
			config,
			true,
		)?;
		synced.push((name.clone(), label));
	}
	drop(conn);

	let _ = log::write(
		app,
		&LogSource::Backend,
		"info",
		&format!(
			"[mcp] 同步「{}」成功: {} 个工具",
			server.name,
			synced.len()
		),
	);
	Ok(SyncSummary {
		server_id: server.id,
		server_name: server.name.clone(),
		ok: true,
		tool_count: synced.len(),
		tools: synced.into_iter().map(|(_, label)| label).collect(),
		error: None,
	})
}

/// 按 id 同步 (供命令调用); 服务器禁用时清理工具并断开连接
pub async fn sync_server_by_id(app: &AppHandle, id: i64) -> Result<SyncSummary, String> {
	let state = app
		.try_state::<db::Db>()
		.ok_or_else(|| "数据库未就绪".to_string())?;
	let server = {
		let conn = state
			.0
			.lock()
			.map_err(|e| format!("获取数据库连接失败: {e}"))?;
		mcp_repository::get(&conn, id)?.ok_or_else(|| "MCP 服务器不存在".to_string())?
	};
	if !server.enabled {
		disable_server(app, id).await;
		return Ok(SyncSummary {
			server_id: id,
			server_name: server.name.clone(),
			ok: true,
			tool_count: 0,
			tools: Vec::new(),
			error: None,
		});
	}
	sync_server(app, &server).await
}

/// 同步全部已启用服务器 (启动时 / 手动触发), 禁用的服务器清理工具并断开
pub async fn sync_all(app: &AppHandle) -> Vec<SyncSummary> {
	let state = match app.try_state::<db::Db>() {
		Some(state) => state,
		None => return Vec::new(),
	};
	let servers = {
		let conn = match state.0.lock() {
			Ok(conn) => conn,
			Err(_) => return Vec::new(),
		};
		mcp_repository::list(&conn).unwrap_or_default()
	};
	let mut results = Vec::new();
	for server in servers {
		if server.enabled {
			match sync_server(app, &server).await {
				Ok(summary) => results.push(summary),
				Err(error) => {
					let _ = log::write(
						app,
						&LogSource::Backend,
						"error",
						&format!("[mcp] 同步「{}」失败: {error}", server.name),
					);
					results.push(SyncSummary {
						server_id: server.id,
						server_name: server.name.clone(),
						ok: false,
						tool_count: 0,
						tools: Vec::new(),
						error: Some(error),
					});
				}
			}
		} else {
			disable_server(app, server.id).await;
		}
	}
	results
}

/// 清理某服务器的工具并断开缓存连接 (禁用/删除时调用)
pub async fn disable_server(app: &AppHandle, id: i64) {
	if let Some(state) = app.try_state::<db::Db>() {
		if let Ok(conn) = state.0.lock() {
			let _ = tool_repository::delete_mcp_tools_by_server(&conn, id);
		}
	}
	McpRuntime::global().close_server(id).await;
}

/// 工具是否属于 MCP provider (Agent 循环据此走异步专用路径)
pub fn is_mcp_provider(provider: &str) -> bool {
	provider == "mcp"
}

#[allow(unused)]
fn _assert_connection_send_sync() {
	fn assert_send_sync<T: Send + Sync>() {}
	assert_send_sync::<McpConnection>();
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde_json::json;

	fn fake_server() -> McpServerRecord {
		McpServerRecord {
			id: 1,
			name: "probe".to_string(),
			description: String::new(),
			transport: "stdio".to_string(),
			command: "node".to_string(),
			args: json!(["tests/fixtures/fake_mcp_server.mjs"]),
			url: String::new(),
			headers: json!({}),
			env: json!({}),
			enabled: true,
			created_at: 0,
			updated_at: 0,
		}
	}

	#[test]
	fn mcp_stdio_smoke() {
		let runtime = tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.expect("tokio runtime");
		runtime.block_on(async {
			let server = fake_server();
			let connection = connect(&server).await.expect("connect stdio server");
			let tools = connection
				.peer
				.list_all_tools()
				.await
				.expect("list tools");
			assert!(
				tools.iter().any(|tool| tool.name == "echo" && tool.title.as_deref() == Some("回显")),
				"应发现 echo 工具"
			);
			let echo = call_tool(&server, "echo", json!({"text": "hello"})).await.expect("call echo");
			assert_eq!(echo["text"], "hello", "echo 应返回 hello");
			let add = call_tool(&server, "add", json!({"a": 40, "b": 2})).await.expect("call add");
			assert_eq!(add["sum"], 42, "add 应返回 42");
		});
	}

	#[test]
	fn mcp_sse_smoke() {
		let mut child = std::process::Command::new("node")
			.args(["tests/fixtures/fake_mcp_server.mjs", "--sse"])
			.spawn()
			.expect("spawn sse probe");
		std::thread::sleep(std::time::Duration::from_millis(500));
		let runtime = tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
			.expect("tokio runtime");
		let result = runtime.block_on(async {
			let server = McpServerRecord {
				id: 2,
				name: "probe-sse".to_string(),
				description: String::new(),
				transport: "sse".to_string(),
				command: String::new(),
				args: json!([]),
				url: "http://127.0.0.1:18789/mcp".to_string(),
				headers: json!({}),
				env: json!({}),
				enabled: true,
				created_at: 0,
				updated_at: 0,
			};
			let connection = connect(&server).await.expect("connect sse server");
			let tools = connection
				.peer
				.list_all_tools()
				.await
				.expect("list sse tools");
			assert!(
				tools.iter().any(|tool| tool.name == "add"),
				"应发现 add 工具"
			);
			let echo = call_tool(&server, "echo", json!({"text": "sse-hello"})).await.expect("call echo via sse");
			assert_eq!(echo["text"], "sse-hello", "SSE echo 应返回 sse-hello");
			Ok::<(), String>(())
		});
		let _ = child.kill();
		result.expect("sse smoke ok");
	}
}
