/**
 * OpenAI Responses API 适配器
 */
import {config} from "../config"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {backendGenerate, backendListModels, backendTestConnection} from "./http"
import {
	clearPlatformApiKey,
	hasPlatformApiKey,
	loadPlatformBase,
	savePlatformBase,
	validatePlatformConfig,
} from "./platform"

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
 * 读取整份配置
 */
export const loadConfig = async (): Promise<OpenAiResponsesConfig> => {
	const DEFAULTS = defaultConfig()
	const BASE = await loadPlatformBase(PREFIX, DEFAULTS)
	const reasoningEffort = await config.getRaw(`${PREFIX}_reasoning_effort`)
	return {
		baseUrl: BASE.baseUrl,
		apiKey: BASE.apiKey,
		model: BASE.model,
		reasoningEffort: toReasoningEffort(reasoningEffort, DEFAULTS.reasoningEffort),
	}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: OpenAiResponsesConfig): Promise<void> => {
	await savePlatformBase(PREFIX, cfg, defaultConfig())
	await config.setRaw(`${PREFIX}_reasoning_effort`, cfg.reasoningEffort)
}

/**
 * 是否已保存过 API Key (只判断是否有密文, 不解密)
 */
export const hasApiKey = (): Promise<boolean> => hasPlatformApiKey(PREFIX)

/**
 * 清除已保存的 API Key
 */
export const clearApiKey = (): Promise<void> => clearPlatformApiKey(PREFIX)

/**
 * OpenAI Responses 适配器实现
 */
export const openAiResponsesAdapter: LLMAdapter<OpenAiResponsesConfig> = {
	id: "openai-responses",
	platform: "openai",
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
		const ERROR = validatePlatformConfig(CFG)
		if (ERROR) return {ok: false, error: ERROR}
		return await backendTestConnection(this.platform)
	},
	async listModels(): Promise<LLMModelInfo[]> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return []
		const IDS = await backendListModels(this.platform)
		return (IDS ?? []).map(id => ({id}))
	},
	async hasApiKey() {
		return await hasApiKey()
	},
	async clearApiKey() {
		await clearApiKey()
	},
	async generate(request: LLMGenerateRequest): Promise<LLMGenerateResult> {
		const CFG = await this.loadConfig()
		const ERROR = validatePlatformConfig(CFG)
		if (ERROR) return {ok: false, error: ERROR}
		return await backendGenerate(this.platform, request)
	},
}
