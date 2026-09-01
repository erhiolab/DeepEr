/**
 * 工具注册机服务层
 *
 * 数据源是后端独立 `tools` 表 (SQLite), 通过 Tauri 命令读写:
 * - `tool_list`   : 获取全部工具
 * - `tool_search` : 按关键词搜索 (调用名 / 中文标题 / 描述)
 * 前端只是渲染的总线, 不包含任何工具实现.
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"
import type {ToolDefinition} from "./types"

/**
 * 获取全部工具 (按调用名排序)
 */
export const listTools = async (): Promise<ToolDefinition[]> => {
	try {
		return await invoke<ToolDefinition[]>("tool_list")
	} catch (error) {
		await logger.error("[tools] 获取工具列表失败", error)
		return []
	}
}

/**
 * 搜索工具: 关键词匹配调用名 / 中文标题 / 描述
 */
export const searchTools = async (query: string, limit = 10): Promise<ToolDefinition[]> => {
	try {
		return await invoke<ToolDefinition[]>("tool_search", {
			args: {query, limit},
		})
	} catch (error) {
		await logger.error("[tools] 搜索工具失败", error)
		return []
	}
}

/**
 * 更新工具搜索别名 (前端工具页编辑)
 */
export const updateToolKeywords = async (id: number, keywords: string[]): Promise<boolean> => {
	try {
		await invoke("tool_update_keywords", {id, keywords})
		return true
	} catch (error) {
		await logger.error("[tools] 更新搜索别名失败", error)
		return false
	}
}
