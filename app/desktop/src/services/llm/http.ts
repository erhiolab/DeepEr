import {invoke} from "@tauri-apps/api/core"
import {listen} from "@tauri-apps/api/event"
import useLanguages from "../i18n/useLanguages"
import {logger} from "../logger"
import type {LLMGenerateRequest, LLMGenerateResult, LLMPlatform, LLMTestResult} from "./types"

/**
 * 后端 LLM 命令桥接层
 *
 * 适配器只声明 `platform` (openai / anthropic / google),
 * 具体命令名由这里按平台查表, 消除适配器与 store 里的重复命令映射.
 */

// 后端统一生成结果 (与后端 LlmGenerateOutcome 的 camelCase 对应)
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

// 各平台的后端命令表
const PLATFORM_COMMANDS: Record<LLMPlatform, {
	generate: string
	test: string
	list: string | null
}> = {
	openai: {
		generate: "llm_openai_generate",
		test: "llm_openai_test_connection",
		list: "llm_openai_list_models",
	},
	anthropic: {
		generate: "llm_anthropic_generate",
		test: "llm_anthropic_test_connection",
		list: null,
	},
	google: {
		generate: "llm_google_generate",
		test: "llm_google_test_connection",
		list: "llm_google_list_models",
	},
}

// 后端错误码 → useLanguages().errors 取值器, `http_error` 需带 status
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

// 从请求中抽取后端参数 (与后端命令结构体 camelCase 对齐)
const requestArgs = (request: LLMGenerateRequest, requestId?: string): Record<string, unknown> => ({
	messages: request.messages,
	...(requestId ? {requestId} : {}),
	...(request.model ? {model: request.model} : {}),
	...(request.temperature !== undefined ? {temperature: request.temperature} : {}),
	...(request.maxTokens ? {maxTokens: request.maxTokens} : {}),
})

// 归一化后端生成结果
const toGenerateResult = (result: BackendGenerateResult): LLMGenerateResult => ({
	ok: result.ok,
	...(result.text !== undefined ? {text: result.text} : {}),
	...(result.inputTokens !== undefined ? {inputTokens: result.inputTokens} : {}),
	...(result.outputTokens !== undefined ? {outputTokens: result.outputTokens} : {}),
	...(result.error !== undefined || result.errorCode ? {error: translateError(result.errorCode, result.error)} : {}),
})

/**
 * 发起一次后端 LLM 生成请求
 */
export const backendGenerate = async (
	platform: LLMPlatform,
	request: LLMGenerateRequest,
): Promise<LLMGenerateResult> => {
	try {
		const RESULT = await invoke<BackendGenerateResult>(PLATFORM_COMMANDS[platform].generate, {
			args: requestArgs(request),
		})
		return toGenerateResult(RESULT)
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 生成失败"
		await logger.error("后端 LLM 生成失败", error)
		return {ok: false, error: REASON}
	}
}

/**
 * 发起一次后端 LLM 流式生成请求
 *
 * 后端通过 Tauri 事件 `llm-stream-delta` / `llm-stream-end` 推送增量, 命令返回最终完整结果.
 */
export const backendGenerateStream = async (
	platform: LLMPlatform,
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
		const RESULT = await invoke<BackendGenerateResult>(PLATFORM_COMMANDS[platform].generate, {
			args: requestArgs(request, REQUEST_ID),
		})
		return toGenerateResult(RESULT)
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 流式生成失败"
		await logger.error("后端 LLM 流式生成失败", error)
		return {ok: false, error: REASON}
	} finally {
		DELTA_UNSUB()
	}
}

/**
 * 发起一次后端 LLM 连接测试
 */
export const backendTestConnection = async (platform: LLMPlatform): Promise<LLMTestResult> => {
	try {
		const RESULT = await invoke<BackendTestResult>(PLATFORM_COMMANDS[platform].test)
		return {
			ok: RESULT.ok,
			...(RESULT.status !== undefined ? {status: RESULT.status} : {}),
			...(RESULT.error !== undefined || RESULT.errorCode
				? {error: translateError(RESULT.errorCode, RESULT.error, RESULT.status)}
				: {}),
		}
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 连接测试失败"
		return {ok: false, error: REASON}
	}
}

/**
 * 发起一次后端 LLM 模型列表查询 (平台无列表 API 时返回 null, 由适配器回落预设)
 */
export const backendListModels = async (platform: LLMPlatform): Promise<string[] | null> => {
	const COMMAND = PLATFORM_COMMANDS[platform].list
	if (!COMMAND) return null
	try {
		return await invoke<string[]>(COMMAND)
	} catch (error) {
		await logger.error("后端 LLM 模型列表查询失败", error)
		return []
	}
}
