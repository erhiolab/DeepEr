/**
 * Anthropic Messages API 适配器
 */
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {backendGenerate, backendTestConnection} from "./http"
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
 * 读取整份配置
 */
export const loadConfig = async (): Promise<AnthropicMessagesConfig> => {
	const BASE = await loadPlatformBase(PREFIX, defaultConfig())
	return {baseUrl: BASE.baseUrl, apiKey: BASE.apiKey, model: BASE.model}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: AnthropicMessagesConfig): Promise<void> => {
	await savePlatformBase(PREFIX, cfg, defaultConfig())
}

/**
 * 是否已保存过 API Key
 */
export const hasApiKey = (): Promise<boolean> => hasPlatformApiKey(PREFIX)

/**
 * 清除已保存的 API Key
 */
export const clearApiKey = (): Promise<void> => clearPlatformApiKey(PREFIX)

/**
 * Anthropic Messages 适配器实现
 */
export const anthropicMessagesAdapter: LLMAdapter<AnthropicMessagesConfig> = {
	id: "anthropic-messages",
	platform: "anthropic",
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
		const ERROR = validatePlatformConfig(CFG)
		if (ERROR) return {ok: false, error: ERROR}
		return await backendTestConnection(this.platform)
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
		const ERROR = validatePlatformConfig(CFG)
		if (ERROR) return {ok: false, error: ERROR}
		return await backendGenerate(this.platform, request)
	},
}
