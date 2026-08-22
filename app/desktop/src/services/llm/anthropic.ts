/**
 * Anthropic Messages API 适配器
 * 协议: https://docs.anthropic.com/en/api/messages
 * 端点: POST {base}/v1/messages
 * 鉴权: x-api-key: <apiKey>, anthropic-version: 2023-06-01
 * 说明: Messages 协议的 system 是独立顶层字段, 其余消息只有 user / assistant 两种角色.
 */
import {config} from "../config"
import {logger} from "../logger"
import type {LLMAdapter, LLMModelInfo, LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "./types"
import {llmHttpRequest, readJsonField} from "./http"

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
 * id 为真实模型名, label 为该模型的简记.
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
 * 拼接 {base}/v1/messages 完整地址
 */
export const buildMessagesUrl = (cfg: Pick<AnthropicMessagesConfig, "baseUrl">): string => {
	const BASE = normalizeBaseUrl(cfg.baseUrl).replace(/\/+$/, "")
	return `${BASE}/v1/messages`
}

/**
 * 构造一次生成请求体 (Anthropic Messages 格式)
 * system 独立提取, 其余消息合并为 user/assistant 交替序列.
 */
export const buildBody = (
	config: {model: string; temperature: number; maxTokens: number},
	request: Pick<LLMGenerateRequest, "messages">,
): Record<string, unknown> => {
	const SYSTEM = request.messages
		.filter(msg => msg.role === "system")
		.map(msg => msg.content)
		.join("\n")
	const MESSAGES = request.messages
		.filter(msg => msg.role !== "system")
		.map(msg => ({
			role: msg.role === "assistant" ? "assistant" : "user",
			content: msg.content,
		}))
	const BODY: Record<string, unknown> = {
		model: config.model,
		messages: MESSAGES,
		temperature: config.temperature,
		...(config.maxTokens > 0 ? {max_tokens: config.maxTokens} : {}),
	}
	if (SYSTEM) BODY.system = SYSTEM
	return BODY
}

/**
 * 构造测试请求体
 */
export const buildTestBody = (config: AnthropicMessagesConfig): Record<string, unknown> => {
	return {
		model: config.model,
		max_tokens: 1,
		messages: [{role: "user", content: "ping"}],
	}
}

/**
 * 从 Messages 响应中提取文本流 (content 里的 text 段拼接)
 */
export const extractText = (body: unknown): string => {
	const CONTENT = readJsonField(body, "content")
	if (!Array.isArray(CONTENT)) return ""
	return CONTENT
		.map((part: unknown) => {
			if (!part || typeof part !== "object") return ""
			const OBJ = part as Record<string, unknown>
			if (OBJ.type === "text") return String(OBJ.text ?? "")
			return ""
		})
		.join("")
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
		apiKey: apiKey ?? DEFAULTS.apiKey,
		model: model || DEFAULTS.model,
	}
}

/**
 * 保存整份配置
 */
export const saveConfig = async (cfg: AnthropicMessagesConfig): Promise<void> => {
	await Promise.all([
		config.setRaw(`${PREFIX}_base_url`, normalizeBaseUrl(cfg.baseUrl)),
		config.setRaw(`${PREFIX}_api_key`, cfg.apiKey),
		config.setRaw(`${PREFIX}_model`, cfg.model),
	])
	await logger.info("保存 Anthropic Messages 配置")
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
		try {
			const RES = await llmHttpRequest({
				url: buildMessagesUrl(CFG),
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": CFG.apiKey.trim(),
					"anthropic-version": "2023-06-01",
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
		return ANTHROPIC_MODELS.map(m => ({...m}))
	},
	async generate(request): Promise<LLMGenerateResult> {
		const CFG = await this.loadConfig()
		if (!CFG.apiKey.trim()) return {ok: false, error: "未填写 API Key"}
		if (!CFG.model.trim()) return {ok: false, error: "未填写模型名"}
		try {
			const RES = await llmHttpRequest({
				url: buildMessagesUrl(CFG),
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": CFG.apiKey.trim(),
					"anthropic-version": "2023-06-01",
				},
				body: buildBody({model: CFG.model, temperature: 1, maxTokens: 0}, request),
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
