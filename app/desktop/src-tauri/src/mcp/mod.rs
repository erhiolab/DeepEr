//! MCP (Model Context Protocol) 服务器模块
//!
//! 管理外部 MCP 服务器配置 (mcp_servers 表), 供后续 MCP Provider 接入工具.
//! - [`model`]     : McpServerRecord / McpServerInput
//! - [`repository`]: mcp_servers 表增删改查

pub mod model;
pub mod repository;
pub mod runtime;
