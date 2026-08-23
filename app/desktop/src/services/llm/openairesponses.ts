/**
 * OpenAI Responses API 适配器
 * 协议: https://platform.openai.com/docs/api-reference/responses
 * 端点: POST {base}/v1/responses
 * 鉴权: Authorization: Bearer <apiKey>
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {llmHttpRequest, readJsonField} from "./http"

/**
 * 配置键前缀
 */
export const PREFIX = "llm_openai_responses"

/**
 * 思考等级可选值 (OpenAI Responses `reasoning.effort`)
 * - "" (空) : 不携带 reasoning 字段, 使用平台默认思考模式
 * - none    : 显式关闭思考 (reasoning.effort = "none")
 * - low / medium / high: 直接传给 API
 */
export const OPENAI_REASONING_EFFORTS = ["", "none", "low", "medium", "high"] as const

/**
 * 思考等级
 */
export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number]

/**
 * OpenAI Responses 完整配置
 */
export interface OpenAiResponsesConfig {
	baseUrl: string
	apiKey: string
	model: string
	reasoningEffort: OpenAiReasoningEffort
}

/**
 * 默认配置
 */
export const defaultConfig: () => OpenAiResponsesConfig = () => {
	return {
		baseUrl: "https://api.openai.com",
		apiKey: "",
		model: "",
		reasoningEffort: "",
	}
}

/**
 * 校验思考等级, 非法值回落默认
 */
const toReasoningEffort = (raw: string | null, fallback: OpenAiReasoningEffort): OpenAiReasoningEffort => {
	return raw && (OPENAI_REASONING_EFFORTS as readonly string[]).includes(raw)
		? (raw as OpenAiReasoningEffort)
		: fallback
}

/**
 * 归一化服务地址: 去掉首尾空白, 自动补全 https:// 前缀
 */
export const normalizeBaseUrl = (raw: string): string => {
	const TRIMMED = raw.trim()
	if (!TRIMMED) return defaultConfig().baseUrl
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(TRIMMED)) return TRIMMED
	return `https://${TRIMMED}`
}

/**
 * 拼接 {base}/v1/responses 完整地址 (支持用户自建网关兼容路径)
 */
export const buildResponsesUrl = (cfg: Pick<OpenAiResponsesConfig, "baseUrl">): string => {
	const BASE = normalizeBaseUrl(cfg.baseUrl).replace(/\/+$/, "")
	return `${BASE}/v1/responses`
}

/**
 * 拼接模型列表地址 {base}/v1/models
 */
export const buildModelsUrl = (cfg: Pick<OpenAiResponsesConfig, "baseUrl">): string => {
	const BASE = normalizeBaseUrl(cfg.baseUrl).replace(/\/+$/, "")
	return `${BASE}/v1/models`
}

/**
 * 从 /models 响应中提取模型 id 列表 (OpenAI: data[].id)
 */
export const parseModels = (body: unknown): LLMModelInfo[] => {
	const DATA = readJsonField(body, "data")
	if (!Array.isArray(DATA)) return []
	return DATA
		.map(item => {
			if (!item || typeof item !== "object") return null
			const ID = String((item as Record<string, unknown>).id ?? "").trim()
			return ID ? ID : null
		})
		.filter((id): id is string => !!id)
		.sort()
		.map(id => ({id}))
}

/**
 * 构造一次生成请求体 (OpenAI Responses 格式)
 */
export const buildBody = (
	config: {model: string; temperature: number; maxTokens: number; reasoningEffort?: OpenAiReasoningEffort},
	request: Pick<LLMGenerateRequest, "messages">,
	): Record<string, unknown> => {
	const INPUT = request.messages.map(msg => ({
		role: msg.role,
		content: msg.content,
	}))
	const BODY: Record<string, unknown> = {
		model: config.model,
		input: INPUT,
		temperature: config.temperature,
		...(config.maxTokens > 0 ? {max_output_tokens: config.maxTokens} : {}),
	}
	if (config.reasoningEffort) {
		BODY.reasoning = {effort: config.reasoningEffort}
	}
	return BODY
}

/**
 * 构造测试请求体
 */
export const buildTestBody = (config: OpenAiResponsesConfig): Record<string, unknown> => {
	const BODY: Record<string, unknown> = {
		model: config.model,
		input: [{role: "user", content: "ping"}],
		max_output_tokens: 1,
	}
	if (config.reasoningEffort) {
		BODY.reasoning = {effort: config.reasoningEffort}
	}
	return BODY
}

/**
 * 从 Responses 响应中提取文本流 (逐段拼接 text)
 */
export const extractText = (body: unknown): string => {
	const OUTPUT = readJsonField(body, "output")
	if (!Array.isArray(OUTPUT)) return ""
	return OUTPUT
		.map((part: unknown) => {
			if (!part || typeof part !== "object") return ""
			const OBJ = part as Record<string, unknown>
			if (OBJ.type === "message") {
				const CONTENT = OBJ.content
				if (Array.isArray(CONTENT)) {
					return CONTENT
						.map(c => (c && typeof c === "object" ? String((c as Record<string, unknown>).text ?? "") : ""))
						.join("")
				}
				return ""
			}
			return ""
		})
		.join("")
}

/**
 * 读取整份配置
 */
export const loadConfig = async (): Promise<OpenAiResponsesConfig> => {
	const DEFAULTS = defaultConfig()
	const [baseUrl, apiKey, model, reasoningEffort] = await Promise.all([
		config.getRaw(`${PREFIX}_base_url`),
		config.getRaw(`${PREFIX}_api_key`),
		config.getRaw(`${PREFIX}_model`),
		config.getRaw(`${PREFIX}_reasoning_effort`),
	])
	return {
		baseUrl: baseUrl ?? DEFAULTS.baseUrl,
		apiKey: await decryptSecret(apiKey ?? ""),
		model: model || DEFAULTS.model,
		reasoningEffort: toReasoningEffort(reasoningEffort, DEFAULTS.reasoningEffort),
	}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: OpenAiResponsesConfig): Promise<void> => {
	const API_KEY_TO_STORE = cfg.apiKey ? await encryptSecret(cfg.apiKey) : (await config.getRaw(`${PREFIX}_api_key`)) ?? ""
	await Promise.all([
		config.setRaw(`${PREFIX}_base_url`, normalizeBaseUrl(cfg.baseUrl)),
		config.setRaw(`${PREFIX}_api_key`, API_KEY_TO_STORE),
		config.setRaw(`${PREFIX}_model`, cfg.model),
		config.setRaw(`${PREFIX}_reasoning_effort`, cfg.reasoningEffort),
	])
	await logger.info("保存 OpenAI Responses 配置")
}

/**
 * 是否已保存过 API Key (只判断是否有密文, 不解密)
 */
export const hasApiKey = async (): Promise<boolean> => {
	const SAVED = await config.getRaw(`${PREFIX}_api_key`)
	return !!SAVED && SAVED !== ""
}

/**
 * 清除已保存的 API Key
 */
export const clearApiKey = async (): Promise<void> => {
	await config.setRaw(`${PREFIX}_api_key`, "")
	await logger.info("清除 OpenAI Responses 的 API Key")
}

/**
 * OpenAI Responses 适配器实现
 */
export const openAiResponsesAdapter: LLMAdapter<OpenAiResponsesConfig> = {
	id: "openai-responses",
	label: "OpenAI Responses",
	description: "OpenAI 最新 Responses API (含 gpt-5 系列 / 兼容网关)",
	async loadConfig() {
		return await loadConfig()
	},
	async saveConfig(cfg) {
		await saveConfig(cfg)
	},
	async testConnection(): Promise<LLMTestResult> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return {ok: false, error: "未填写 API Key"}
		if (!CFG.model.trim()) return {ok: false, error: "未填写模型名"}
		try {
			const RES = await llmHttpRequest({
				url: buildResponsesUrl(CFG),
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${CFG.apiKey.trim()}`,
				},
				body: buildTestBody(CFG),
			})
			if (RES.status >= 200 && RES.status < 300) return {ok: true, status: RES.status}
			return {ok: false, status: RES.status, error: `HTTP ${RES.status}`}
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)}
		}
	},
	async listModels(): Promise<LLMModelInfo[]> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return []
		try {
			const RES = await llmHttpRequest({
				url: buildModelsUrl(CFG),
				method: "GET",
				headers: {Authorization: `Bearer ${CFG.apiKey.trim()}`},
				body: null,
			})
			if (RES.status < 200 || RES.status >= 300) return []
			return parseModels(RES.body)
		} catch {
			return []
		}
	},
	async hasApiKey() {
		return await hasApiKey()
	},
	async clearApiKey() {
		await clearApiKey()
	},
	async generate(request): Promise<LLMGenerateResult> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return {ok: false, error: "未填写 API Key"}
		if (!CFG.model.trim()) return {ok: false, error: "未填写模型名"}
		try {
			const RES = await llmHttpRequest({
				url: buildResponsesUrl(CFG),
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${CFG.apiKey.trim()}`,
				},
				body: buildBody(
					{
						model: CFG.model,
						temperature: 1,
						maxTokens: 0,
						reasoningEffort: CFG.reasoningEffort,
					},
					request,
				),
			})
			const TEXT = extractText(RES.body)
			const USAGE = readJsonField(RES.body, "usage")
			const inputTokens =
				USAGE && typeof USAGE === "object"
					? Number((USAGE as Record<string, unknown>).input_tokens ?? 0) || undefined
					: undefined
			const outputTokens =
				USAGE && typeof USAGE === "object"
					? Number((USAGE as Record<string, unknown>).output_tokens ?? 0) || undefined
					: undefined
			return {ok: true, text: TEXT, inputTokens, outputTokens}
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)}
		}
	},
}
