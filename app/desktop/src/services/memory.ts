/**
 * 长期记忆 API 层
 *
 * 数据在后端 memories + memory_tags 表; 搜索按回忆打分排序并强化命中记忆.
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * 一条长期记忆 (与后端 MemoryRecord camelCase 对齐)
 */
export interface MemoryRecord {
	id: number
	content: string
	type: string
	importance: number
	confidence: number
	tags: string[]
	accessCount: number
	lastAccessedAt: number | null
	expiresAt: number | null
	status: string
	createdAt: number
	updatedAt: number
	recallScore?: number
}

/**
 * 记忆写入参数
 */
export interface MemoryInput {
	content: string
	type: string
	importance: number
	confidence: number
	tags: string[]
	expiresAt?: number | null
}

/**
 * 全部记忆 (按创建时间倒序)
 */
export const listMemories = async (limit = 200): Promise<MemoryRecord[]> => {
	try {
		return await invoke<MemoryRecord[]>("memory_list", {limit})
	} catch (error) {
		await logger.error("[memory] 获取记忆列表失败", error)
		return []
	}
}

/**
 * 搜索记忆 (内容 / 标签命中, 按回忆打分排序)
 */
export const searchMemories = async (query: string, limit = 20): Promise<MemoryRecord[]> => {
	try {
		return await invoke<MemoryRecord[]>("memory_search", {args: {query, limit}})
	} catch (error) {
		await logger.error("[memory] 搜索记忆失败", error)
		return []
	}
}

/**
 * 新建记忆
 */
export const createMemory = async (input: MemoryInput): Promise<MemoryRecord | null> => {
	try {
		return await invoke<MemoryRecord>("memory_create", {args: input})
	} catch (error) {
		await logger.error("[memory] 创建记忆失败", error)
		return null
	}
}

/**
 * 更新记忆
 */
export const updateMemory = async (id: number, input: MemoryInput): Promise<MemoryRecord | null> => {
	try {
		return await invoke<MemoryRecord>("memory_update", {id, args: input})
	} catch (error) {
		await logger.error("[memory] 更新记忆失败", error)
		return null
	}
}

/**
 * 删除记忆
 */
export const deleteMemory = async (id: number): Promise<boolean> => {
	try {
		await invoke("memory_delete", {id})
		return true
	} catch (error) {
		await logger.error("[memory] 删除记忆失败", error)
		return false
	}
}
