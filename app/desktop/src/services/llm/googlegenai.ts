/**
 * Google GenAI (Gemini) 适配器
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
export const PREFIX = "llm_google_genai"

/**
 * Google GenAI 完整配置
 */
export interface GoogleGenAiConfig {
	baseUrl: string
	apiKey: string
	model: string
}

/**
 * 默认配置
 */
export const defaultConfig: () => GoogleGenAiConfig = () => {
	return {
		baseUrl: "https://generativelanguage.googleapis.com",
		apiKey: "",
		model: "",
	}
}

/**
 * 读取整份配置
 */
export const loadConfig = async (): Promise<GoogleGenAiConfig> => {
	const BASE = await loadPlatformBase(PREFIX, defaultConfig())
	return {baseUrl: BASE.baseUrl, apiKey: BASE.apiKey, model: BASE.model}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: GoogleGenAiConfig): Promise<void> => {
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
 * Google GenAI 适配器实现
 */
export const googleGenAiAdapter: LLMAdapter<GoogleGenAiConfig> = {
	id: "google-genai",
	platform: "google",
	label: "Google GenAI",
	description: "Google Gemini 官方 API (Generate Content)",
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
