/**
 * MCP 服务器 API 层
 *
 * 数据在后端 mcp_servers 表; 支持添加 / 配置 (stdio 与 sse) / 启停 / 删除.
 * 真正的 MCP 客户端接入 (发现工具 / 调用工具) 留待后续阶段.
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * MCP 服务器配置 (与后端 McpServerRecord camelCase 对齐)
 */
export interface McpServerRecord {
	id: number
	name: string
	description: string
	transport: "stdio" | "sse" | "http"
	command: string
	args: unknown[]
	url: string
	headers: Record<string, string>
	env: Record<string, string>
	enabled: boolean
	toolCount: number
	createdAt: number
	updatedAt: number
}

/**
 * MCP 服务器写入参数
 */
export interface McpServerInput {
	name: string
	description: string
	transport: "stdio" | "sse" | "http"
	command: string
	args: unknown[]
	url: string
	headers: Record<string, string>
	env: Record<string, string>
}

/**
 * 全部 MCP 服务器
 */
export const listMcp = async (): Promise<McpServerRecord[]> => {
	try {
		return await invoke<McpServerRecord[]>("mcp_list")
	} catch (error) {
		await logger.error("[mcp] 获取 MCP 服务器列表失败", error)
		return []
	}
}

/**
 * 添加 MCP 服务器
 */
export const createMcp = async (input: McpServerInput): Promise<McpServerRecord | null> => {
	try {
		return await invoke<McpServerRecord>("mcp_create", {args: input})
	} catch (error) {
		await logger.error("[mcp] 添加 MCP 服务器失败", error)
		return null
	}
}

/**
 * 配置 MCP 服务器
 */
export const updateMcp = async (id: number, input: McpServerInput): Promise<McpServerRecord | null> => {
	try {
		return await invoke<McpServerRecord>("mcp_update", {id, args: input})
	} catch (error) {
		await logger.error("[mcp] 配置 MCP 服务器失败", error)
		return null
	}
}

/**
 * 删除 MCP 服务器
 */
export const deleteMcp = async (id: number): Promise<boolean> => {
	try {
		await invoke("mcp_delete", {id})
		return true
	} catch (error) {
		await logger.error("[mcp] 删除 MCP 服务器失败", error)
		return false
	}
}

/**
 * 切换 MCP 服务器启用状态
 */
export const setMcpEnabled = async (id: number, enabled: boolean): Promise<boolean> => {
	try {
		await invoke("mcp_set_enabled", {id, enabled})
		return true
	} catch (error) {
		await logger.error("[mcp] 切换 MCP 服务器状态失败", error)
		return false
	}
}

/**
 * 同步结果 (与后端 SyncSummary camelCase 对齐)
 */
export interface McpSyncSummary {
	serverId: number
	serverName: string
	ok: boolean
	toolCount: number
	tools: string[]
	error?: string | null
}

/**
 * 手动同步全部已启用的 MCP 服务器 (发现工具写入 tools 表)
 */
export const syncMcp = async (): Promise<McpSyncSummary[]> => {
	try {
		return await invoke<McpSyncSummary[]>("mcp_sync")
	} catch (error) {
		await logger.error("[mcp] 同步 MCP 工具失败", error)
		return []
	}
}
