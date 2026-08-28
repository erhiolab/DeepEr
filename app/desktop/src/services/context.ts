import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * context 记录 (返回给前端, camelCase)
 */
export interface ContextRecord {
	id: number
	type: string
	role: string | null
	content: string
	tokenCount: number
	inputTokens?: number | null
	outputTokens?: number | null
	hitRate?: number | null
	createdAt: number
}

/**
 * 粗略估算一段文本的 token 数 (占位, 后续可替换为真实分词).
 * 纯前端无分词器, 按字符粗略折算 (中文约 1 字 ≈ 1 token, 英文约 4 字符 ≈ 1 token).
 */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4))

/**
 * 记录一条 context (talk / tts 等). 失败不阻塞主流程.
 */
export const contextInsert = async (payload: {
	type: string
	role?: string
	content: string
	tokenCount?: number
	inputTokens?: number | null
	outputTokens?: number | null
	hitRate?: number | null
}): Promise<void> => {
	try {
		await invoke<number>("context_insert", {
			args: {
				type: payload.type,
				role: payload.role,
				content: payload.content,
				tokenCount: payload.tokenCount ?? 0,
				inputTokens: payload.inputTokens ?? null,
				outputTokens: payload.outputTokens ?? null,
				hitRate: payload.hitRate ?? null,
			},
		})
	} catch (error) {
		await logger.error("[context] 写入 context 失败", error)
	}
}

/**
 * 分页读取 context 列表 (最新的在前). 失败返回空数组.
 */
export const contextList = async (limit = 100, offset = 0): Promise<ContextRecord[]> => {
	try {
		return await invoke<ContextRecord[]>("context_list", {
			args: {limit, offset},
		})
	} catch (error) {
		await logger.error("[context] 读取 context 失败", error)
		return []
	}
}
