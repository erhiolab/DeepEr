/**
 * OpenAI Chat Completions API 适配器 (旧版 / 兼容网关)
 *
 * 适用: 只实现 /v1/chat/completions 的服务商与本地网关 (Ollama / LM Studio / one-api 等).
 */
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
export const PREFIX = "llm_openai_chat"

/**
 * OpenAI Chat 完整配置
 */
export interface OpenAiChatConfig {
	baseUrl: string
	apiKey: string
	model: string
}

/**
 * 默认配置
 */
export const defaultConfig: () => OpenAiChatConfig = () => {
	return {
		baseUrl: "https://api.openai.com",
		apiKey: "",
		model: "",
	}
}

/**
 * 读取整份配置
 */
export const loadConfig = async (): Promise<OpenAiChatConfig> => {
	const DEFAULTS = defaultConfig()
	const BASE = await loadPlatformBase(PREFIX, DEFAULTS)
	return {
		baseUrl: BASE.baseUrl,
		apiKey: BASE.apiKey,
		model: BASE.model,
	}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: OpenAiChatConfig): Promise<void> => {
	await savePlatformBase(PREFIX, cfg, defaultConfig())
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
 * OpenAI Chat Completions 适配器实现
 */
export const openAiChatAdapter: LLMAdapter<OpenAiChatConfig> = {
	id: "openai-chat",
	platform: "openai-chat",
	label: "OpenAI (Chat Completions)",
	description: "OpenAI 旧版 / 兼容网关 (chat/completions, 支持 Ollama / LM Studio 等)",
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
