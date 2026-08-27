/**
 * LLM 平台配置通用工具
 *
 * 三个平台适配器 (OpenAI / Anthropic / Google) 的 baseUrl / apiKey / model
 * 读写逻辑完全一致, 收敛到这里; 每个适配器只保留自己的扩展字段
 * (如 OpenAI Responses 的 reasoningEffort).
 */
import {config} from "../config"
import {logger} from "../logger"
import {decryptSecret, encryptSecret} from "../secret"
import useLanguages from "../i18n/useLanguages"

/** 平台配置基础字段 */
export interface PlatformConfigBase {
	baseUrl: string
	apiKey: string
	model: string
}

/**
 * 归一化服务地址: 去掉首尾空白, 自动补全 https:// 前缀
 */
export const normalizeBaseUrl = (raw: string, fallback: string): string => {
	const TRIMMED = raw.trim()
	if (!TRIMMED) return fallback
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(TRIMMED)) return TRIMMED
	return `https://${TRIMMED}`
}

/**
 * 读取基础三字段 (baseUrl / apiKey / model), apiKey 解密为明文
 */
export const loadPlatformBase = async <T extends PlatformConfigBase>(
	prefix: string,
	defaults: T,
): Promise<PlatformConfigBase> => {
	const [baseUrl, apiKey, model] = await Promise.all([
		config.getRaw(`${prefix}_base_url`),
		config.getRaw(`${prefix}_api_key`),
		config.getRaw(`${prefix}_model`),
	])
	return {
		baseUrl: normalizeBaseUrl(baseUrl ?? "", defaults.baseUrl),
		apiKey: await decryptSecret(apiKey ?? ""),
		model: model || defaults.model,
	}
}

/**
 * 保存基础三字段; apiKey 留空表示保留已保存的密文不动
 */
export const savePlatformBase = async <T extends PlatformConfigBase>(
	prefix: string,
	cfg: T,
	defaults: T,
): Promise<void> => {
	const API_KEY_TO_STORE = cfg.apiKey ? await encryptSecret(cfg.apiKey) : (await config.getRaw(`${prefix}_api_key`)) ?? ""
	await Promise.all([
		config.setRaw(`${prefix}_base_url`, normalizeBaseUrl(cfg.baseUrl, defaults.baseUrl)),
		config.setRaw(`${prefix}_api_key`, API_KEY_TO_STORE),
		config.setRaw(`${prefix}_model`, cfg.model),
	])
	await logger.info(`保存平台配置: ${prefix}`)
}

/**
 * 是否已保存过 API Key (只判断是否有密文, 不解密)
 */
export const hasPlatformApiKey = async (prefix: string): Promise<boolean> => {
	const SAVED = await config.getRaw(`${prefix}_api_key`)
	return !!SAVED && SAVED !== ""
}

/**
 * 清除已保存的 API Key
 */
export const clearPlatformApiKey = async (prefix: string): Promise<void> => {
	await config.setRaw(`${prefix}_api_key`, "")
	await logger.info(`清除平台 API Key: ${prefix}`)
}

/**
 * 校验配置是否可发起请求, 返回错误文案 (null = 通过)
 */
export const validatePlatformConfig = (cfg: {apiKey: string; model: string}): string | null => {
	const ERRORS = useLanguages().errors
	if (!cfg.apiKey.trim()) return ERRORS.missingApiKey
	if (!cfg.model.trim()) return ERRORS.missingModel
	return null
}
