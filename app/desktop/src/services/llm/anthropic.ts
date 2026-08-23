/**
 * Anthropic Messages API 适配器
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {backendGenerate, backendTestConnection} from "./http"

/**
 * 配置键前缀
 */
export const PREFIX = "llm_anthropic_messages"

/**
 * Anthropic Messages 完整配置
 */
export interface AnthropicMessagesConfig {
	baseUrl: string
	apiKey: string
	model: string
}

/**
 * 默认配置
 */
export const defaultConfig: () => AnthropicMessagesConfig = () => {
	return {
		baseUrl: "https://api.anthropic.com",
		apiKey: "",
		model: "",
	}
}

/**
 * Anthropic 已知模型预设 (无公开 model list API, 内置下拉供选择)
 */
export const ANTHROPIC_MODELS: LLMModelInfo[] = [
	{id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (均衡)"},
	{id: "claude-opus-4-1", label: "Claude Opus 4.1 (最强)"},
	{id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (快速)"},
	{id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (2025-05-14)"},
	{id: "claude-opus-4-latest", label: "Claude Opus 4 (最近版)"},
]

/**
 * 归一化服务地址
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
export const loadConfig = async (): Promise<AnthropicMessagesConfig> => {
	const DEFAULTS = defaultConfig()
	const [baseUrl, apiKey, model] = await Promise.all([
		config.getRaw(`${PREFIX}_base_url`),
		config.getRaw(`${PREFIX}_api_key`),
		config.getRaw(`${PREFIX}_model`),
	])
	return {
		baseUrl: baseUrl ?? DEFAULTS.baseUrl,
		apiKey: await decryptSecret(apiKey ?? ""),
		model: model || DEFAULTS.model,
	}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: AnthropicMessagesConfig): Promise<void> => {
	const API_KEY_TO_STORE = cfg.apiKey ? await encryptSecret(cfg.apiKey) : (await config.getRaw(`${PREFIX}_api_key`)) ?? ""
	await Promise.all([
		config.setRaw(`${PREFIX}_base_url`, normalizeBaseUrl(cfg.baseUrl)),
		config.setRaw(`${PREFIX}_api_key`, API_KEY_TO_STORE),
		config.setRaw(`${PREFIX}_model`, cfg.model),
	])
	await logger.info("保存 Anthropic Messages 配置")
}

/**
 * 是否已保存过 API Key
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
	await logger.info("清除 Anthropic Messages 的 API Key")
}

/**
 * Anthropic Messages 适配器实现
 */
export const anthropicMessagesAdapter: LLMAdapter<AnthropicMessagesConfig> = {
	id: "anthropic-messages",
	label: "Anthropic Messages",
	description: "Anthropic 官方 Messages API (Claude 系列 / 兼容网关)",
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
		return await backendTestConnection("llm_anthropic_test_connection")
	},
	async listModels(): Promise<LLMModelInfo[]> {
		return ANTHROPIC_MODELS.map(m => ({...m}))
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
		return await backendGenerate("llm_anthropic_generate", request)
	},
}
