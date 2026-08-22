import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"

/**
 * 通过后端 invoke 发起一个 HTTP 请求.
 * 请求体 / 响应均由适配器自己按平台协议构造与解析.
 * 网络层失败抛 Error(message), 供调用方转为统一的失败结果.
 */
export const llmHttpRequest = async (options: {
	url: string
	method: string
	headers: Record<string, string>
	body: unknown
	timeoutMs?: number
}): Promise<{ status: number; body: unknown }> => {
	try {
		return await invoke<{ status: number; body: unknown }>("llm_http_request", options)
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 请求失败"
		await logger.error("LLM HTTP 请求失败", error)
		throw new Error(REASON)
	}
}

/**
 * 从 JSON 响应体中稳健提取顶层字段
 */
export const readJsonField = (body: unknown, key: string): unknown => {
	if (body && typeof body === "object") {
		return (body as Record<string, unknown>)[key]
	}
	return undefined
}
