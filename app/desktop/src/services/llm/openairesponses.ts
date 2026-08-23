/**
 * OpenAI Responses API 适配器
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {backendGenerate, backendTestConnection, backendListModels} from "./http"

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
		return await backendTestConnection("llm_openai_test_connection")
	},
	async listModels(): Promise<LLMModelInfo[]> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return []
		const IDS = await backendListModels("llm_openai_list_models")
		return IDS.map(id => ({id}))
	},
	async hasApiKey() {
		return await hasApiKey()
	},
	async clearApiKey() {
		await clearApiKey()
	},
	async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return {ok: false, error: "未填写 API Key"}
		if (!CFG.model.trim()) return {ok: false, error: "未填写模型名"}
		return await backendGenerate("llm_openai_generate", request)
	},
}
