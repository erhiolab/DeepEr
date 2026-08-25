import {invoke} from "@tauri-apps/api/core"
import {listen} from "@tauri-apps/api/event"
import useLanguages from "../i18n/useLanguages"
import {logger} from "../logger"
import type {LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"

/**
 * 后端 LLM 命令桥接层
 */

/**
 * 后端统一生成结果 (与后端 LlmGenerateOutcome 的 camelCase 对应)
 */
interface BackendGenerateResult {
	ok: boolean
	text?: string
	inputTokens?: number
	outputTokens?: number
	error?: string
	errorCode?: string
}

/**
 * 后端统一连接测试结果 (与后端 LlmTestOutcome 的 camelCase 对应)
 */
export interface BackendTestResult {
	ok: boolean
	status?: number
	error?: string
	errorCode?: string
}

/**
 * 后端错误码 → useLanguages().errors 取值器, `http_error` 需带 status.
 */
const translateError = (code: string | undefined, fallback: string | undefined, status?: number): string => {
	if (!code) return fallback ?? "操作失败"
	const ERRORS = useLanguages().errors
	switch (code) {
		case "missing_api_key":
			return ERRORS.missingApiKey
		case "missing_model":
			return ERRORS.missingModel
		case "network_error":
			return ERRORS.networkError
		case "http_error":
			return ERRORS.httpError(status)
		default:
			return fallback ?? "操作失败"
	}
}

/**
 * 发起一次后端 LLM 生成请求
 *
 * @param platform 平台命令前缀, 如 `llm_openai_generate`
 * @param request  统一生成请求(含覆写参数)
 */
export const backendGenerate = async (
	platform: "llm_openai_generate" | "llm_anthropic_generate" | "llm_google_generate",
	request: LLMGenerateRequest,
): Promise<LLMGenerateResult> => {
	try {
		const RESULT = await invoke<BackendGenerateResult>(platform, {
			args: {
				messages: request.messages,
				...(request.model ? {model: request.model} : {}),
				...(request.temperature !== undefined ? {temperature: request.temperature} : {}),
				...(request.maxTokens ? {maxTokens: request.maxTokens} : {}),
			},
		})
		return {
			ok: RESULT.ok,
			...(RESULT.text !== undefined ? {text: RESULT.text} : {}),
			...(RESULT.inputTokens !== undefined ? {inputTokens: RESULT.inputTokens} : {}),
			...(RESULT.outputTokens !== undefined ? {outputTokens: RESULT.outputTokens} : {}),
			...(RESULT.error !== undefined || RESULT.errorCode ? {error: translateError(RESULT.errorCode, RESULT.error)} : {}),
		}
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 生成失败"
		await logger.error("后端 LLM 生成失败", error)
		return {ok: false, error: REASON}
	}
}

/**
 * 发起一次后端 LLM 流式生成请求
 *
 * @param platform 平台命令前缀, 如 `llm_openai_generate`
 * @param request  统一生成请求 (覆写参数)
 * @param onDelta  每收到一段增量文本时回调 (用于流式渲染)
 *
 * 后端通过 Tauri 事件 `llm-stream-delta` / `llm-stream-end` 推送增量, 命令返回最终的完整结果.
 */
export const backendGenerateStream = async (
	platform: "llm_openai_generate" | "llm_anthropic_generate" | "llm_google_generate",
	request: LLMGenerateRequest,
	onDelta?: (delta: string) => void,
): Promise<LLMGenerateResult> => {
	const REQUEST_ID =
		(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
			? crypto.randomUUID()
			: `req_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
	// 监听增量与结束事件, 按 requestId 匹配
	const DELTA_UNSUB = await listen<{requestId: string, delta: string}>("llm-stream-delta", event => {
		if (event.payload.requestId === REQUEST_ID) onDelta?.(event.payload.delta)
	})
	try {
		const RESULT = await invoke<BackendGenerateResult>(platform, {
			args: {
				messages: request.messages,
				requestId: REQUEST_ID,
				...(request.model ? {model: request.model} : {}),
				...(request.temperature !== undefined ? {temperature: request.temperature} : {}),
				...(request.maxTokens ? {maxTokens: request.maxTokens} : {}),
			},
		})
		return {
			ok: RESULT.ok,
			...(RESULT.text !== undefined ? {text: RESULT.text} : {}),
			...(RESULT.inputTokens !== undefined ? {inputTokens: RESULT.inputTokens} : {}),
			...(RESULT.outputTokens !== undefined ? {outputTokens: RESULT.outputTokens} : {}),
			...(RESULT.error !== undefined || RESULT.errorCode ? {error: translateError(RESULT.errorCode, RESULT.error)} : {}),
		}
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 生成失败"
		await logger.error("后端 LLM 流式生成失败", error)
		return {ok: false, error: REASON}
	} finally {
		DELTA_UNSUB()
	}
}

/**
 * 发起一次后端 LLM 连接测试
 *
 * @param platform 平台命令, 如 `llm_openai_test_connection`
 */
export const backendTestConnection = async (
	platform:
		| "llm_openai_test_connection"
		| "llm_anthropic_test_connection"
		| "llm_google_test_connection",
): Promise<LLMTestResult> => {
	try {
		const RESULT = await invoke<BackendTestResult>(platform)
		return {
			ok: RESULT.ok,
			...(RESULT.status !== undefined ? {status: RESULT.status} : {}),
			...(RESULT.error !== undefined || RESULT.errorCode ? {error: translateError(RESULT.errorCode, RESULT.error, RESULT.status)} : {}),
		}
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 连接测试失败"
		return {ok: false, error: REASON}
	}
}

/**
 * 发起一次后端 LLM 模型列表查询
 *
 * @param platform 平台命令, 如 `llm_openai_list_models`
 */
export const backendListModels = async (
	platform: "llm_openai_list_models" | "llm_google_list_models",
): Promise<string[]> => {
	try {
		return await invoke<string[]>(platform)
	} catch (error) {
		await logger.error("后端 LLM 模型列表查询失败", error)
		return []
	}
}
