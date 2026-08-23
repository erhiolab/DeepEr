/**
 * Google GenAI (Gemini) 适配器
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {backendGenerate, backendTestConnection, backendListModels} from "./http"

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
export const loadConfig = async (): Promise<GoogleGenAiConfig> => {
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
export const saveConfig = async (cfg: GoogleGenAiConfig): Promise<void> => {
	const API_KEY_TO_STORE = cfg.apiKey ? await encryptSecret(cfg.apiKey) : (await config.getRaw(`${PREFIX}_api_key`)) ?? ""
	await Promise.all([
		config.setRaw(`${PREFIX}_base_url`, normalizeBaseUrl(cfg.baseUrl)),
		config.setRaw(`${PREFIX}_api_key`, API_KEY_TO_STORE),
		config.setRaw(`${PREFIX}_model`, cfg.model),
	])
	await logger.info("保存 Google GenAI 配置")
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
	await logger.info("清除 Google GenAI 的 API Key")
}

/**
 * Google GenAI 适配器实现
 */
export const googleGenAiAdapter: LLMAdapter<GoogleGenAiConfig> = {
	id: "google-genai",
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
		if (!CFG.apiKey.trim()) return {ok: false, error: "未填写 API Key"}
		if (!CFG.model.trim()) return {ok: false, error: "未填写模型名"}
		return await backendTestConnection("llm_google_test_connection")
	},
	async listModels(): Promise<LLMModelInfo[]> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return []
		const ids = await backendListModels("llm_google_list_models")
		return ids.map(id => ({id}))
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
		return await backendGenerate("llm_google_generate", request)
	},
}
