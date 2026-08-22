/**
 * Google GenAI (Gemini) 适配器
 * 协议: https://ai.google.dev/api/generate-content
 * 端点: POST {base}/v1beta/models/{model}:generateContent?key={apiKey}
 * 鉴权: URL query 参数 `key` (也兼容 Authorization: Bearer)
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {llmHttpRequest, readJsonField} from "./http"

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
 * 拼接 {base}/v1beta/models/{model}:generateContent 完整地址 (apiKey 用 query 传递)
 */
export const buildGenerateUrl = (cfg: Pick<GoogleGenAiConfig, "baseUrl" | "model" | "apiKey">): string => {
	const BASE = normalizeBaseUrl(cfg.baseUrl).replace(/\/+$/, "")
	const MODEL = encodeURIComponent(cfg.model)
	const KEY = encodeURIComponent(cfg.apiKey.trim())
	const SEP = KEY ? (BASE.includes("?") ? "&" : "?") : ""
	return `${BASE}/v1beta/models/${MODEL}:generateContent${SEP}key=${KEY}`
}

/**
 * 拼接模型列表地址 {base}/v1beta/models (apiKey 用 query 传递)
 */
export const buildModelsUrl = (cfg: Pick<GoogleGenAiConfig, "baseUrl" | "apiKey">): string => {
	const BASE = normalizeBaseUrl(cfg.baseUrl).replace(/\/+$/, "")
	const KEY = encodeURIComponent(cfg.apiKey.trim())
	const SEP = KEY ? (BASE.includes("?") ? "&" : "?") : ""
	return `${BASE}/v1beta/models${SEP}key=${KEY}`
}

/**
 * 从 /models 响应中提取模型名列表 (Gemini: models[].name, 形如 "models/gemini-...")
 */
export const parseModels = (body: unknown): LLMModelInfo[] => {
	const MODELS = readJsonField(body, "models")
	if (!Array.isArray(MODELS)) return []
	return MODELS
		.map(item => {
			if (!item || typeof item !== "object") return null
			const NAME = String((item as Record<string, unknown>).name ?? "").trim()
			const ID = NAME.replace(/^models\//, "")
			return ID ? ID : null
		})
		.filter((id): id is string => !!id)
		.sort()
		.map(id => ({id}))
}

/**
 * 构造一次生成请求体 (Google GenAI 格式)
 * roles 仅支持 user / model, system 用顶层 systemInstruction 装.
 */
export const buildBody = (
	request: Pick<LLMGenerateRequest, "messages">,
): Record<string, unknown> => {
	const SYSTEM = request.messages
		.filter(msg => msg.role === "system")
		.map(msg => msg.content)
		.join("\n")
	const CONTENTS = request.messages
		.filter(msg => msg.role !== "system")
		.map(msg => ({
			role: msg.role === "assistant" ? "model" : "user",
			parts: [{text: msg.content}],
		}))
	const BODY: Record<string, unknown> = {contents: CONTENTS}
	if (SYSTEM) BODY.systemInstruction = {parts: [{text: SYSTEM}]}
	return BODY
}

/**
 * 构造测试请求体
 */
export const buildTestBody = (): Record<string, unknown> => {
	return {
		contents: [{role: "user", parts: [{text: "ping"}]}],
		generationConfig: {maxOutputTokens: 1},
	}
}

/**
 * 从 generateContent 响应中提取文本 (candidates[0].content.parts.text 拼接)
 */
export const extractText = (body: unknown): string => {
	const CANDIDATES = readJsonField(body, "candidates")
	if (!Array.isArray(CANDIDATES)) return ""
	const CAND = CANDIDATES[0]
	if (!CAND || typeof CAND !== "object") return ""
	const CONTENT = (CAND as Record<string, unknown>).content
	if (!CONTENT || typeof CONTENT !== "object") return ""
	const PARTS = (CONTENT as Record<string, unknown>).parts
	if (!Array.isArray(PARTS)) return ""
	return PARTS
		.map((part: unknown) => (part && typeof part === "object" ? String((part as Record<string, unknown>).text ?? "") : ""))
		.join("")
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
		try {
			const RES = await llmHttpRequest({
				url: buildGenerateUrl(CFG),
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: buildTestBody(),
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
				headers: {"Content-Type": "application/json"},
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
				url: buildGenerateUrl(CFG),
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: buildBody(request),
			})
			const TEXT = extractText(RES.body)
			const USAGE = readJsonField(RES.body, "usageMetadata")
			const inputTokens =
				USAGE && typeof USAGE === "object"
					? Number((USAGE as Record<string, unknown>).promptTokenCount ?? 0) || undefined
					: undefined
			const outputTokens =
				USAGE && typeof USAGE === "object"
					? Number((USAGE as Record<string, unknown>).candidatesTokenCount ?? 0) || undefined
					: undefined
			return {ok: true, text: TEXT, inputTokens, outputTokens}
		} catch (error) {
			return {ok: false, error: error instanceof Error ? error.message : String(error)}
		}
	},
}
