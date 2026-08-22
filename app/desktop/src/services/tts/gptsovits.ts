/**
 * GPT-SoVITS 适配器
 * 服务端 API 版本: V2, 接口: GET {base}/tts
 *
 * 所有配置都存进数据库的 config 表 (KV), 键统一带 `tts_gpt_sovits_` 前缀,
 * 这样与其它适配器完全隔离 (解耦), 也符合「配置项写在 config 里」的约定.
 * 这里为避免把具体适配器键扩散到核心 config 类型, 直接经 invoke 读写数据库.
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"
import type {TTSVoiceEntry} from "./types"

/**
 * 合成/参考语言可选值 (GPT-SoVITS API V2 支持; 注意它不支持 `auto`, 必须显式给语言)
 */
export const GPT_SOVITS_LANGUAGES: string[] = ["zh", "en", "ja", "ko", "yue", "all_zh", "all_yue"]

/**
 * 文本切分方式
 */
export const GPT_SOVITS_SPLIT_METHODS: string[] = ["cut0", "cut1", "cut2", "cut3", "cut4", "cut5"]

/**
 * 配置键前缀
 */
export const PREFIX = "tts_gpt_sovits"

/**
 * GPT-SoVITS 完整配置 (与前端表单一一对应)
 */
export interface GptSoVitsConfig {
	url: string
	port: string
	textLang: string
	topK: number
	topP: number
	temperature: number
	textSplitMethod: string
	batchSize: number
	emotions: TTSVoiceEntry[]
}

/**
 * 默认配置
 */
export const defaultConfig: () => GptSoVitsConfig = () => {
	return {
		url: "127.0.0.1",
		port: "9880",
		textLang: "zh",
		topK: 15,
		topP: 1,
		temperature: 1,
		textSplitMethod: "cut5",
		batchSize: 1,
		emotions: [],
	}
}

/**
 * 拼接完整 base 地址, 例: http://127.0.0.1:9880
 */
export const buildBaseUrl = (config: Pick<GptSoVitsConfig, "url" | "port">): string => {
	const HOST = config.url.trim() || "127.0.0.1"
	const PORT = config.port.trim() || "9880"
	return `http://${HOST}:${PORT}`
}

/**
 * 拼接 /tts 完整地址
 */
export const buildTtsUrl = (config: Pick<GptSoVitsConfig, "url" | "port">): string => {
	return `${buildBaseUrl(config)}/tts`
}

/**
 * 构造一次合成请求的查询参数
 */
export const buildParams = (config: Pick<GptSoVitsConfig, "textLang" | "topK" | "topP" | "temperature" | "textSplitMethod" | "batchSize">, text: string, entry: TTSVoiceEntry,): Record<string, unknown> => {
	// 与 api_v2.py 的 POST /tts JSON body 对齐.
	// 合成文本语言来自 config.textLang, 参考音频语言来自 entry.promptLang (每条参考音频独立).
	const PARAMS: Record<string, unknown> = {
		text,
		text_lang: config.textLang,
		ref_audio_path: entry.audioPath,
		prompt_lang: entry.promptLang,
		top_k: config.topK,
		top_p: config.topP,
		temperature: config.temperature,
		text_split_method: config.textSplitMethod,
		batch_size: config.batchSize,
		streaming_mode: false,
	}
	if (entry.promptText) PARAMS["prompt_text"] = entry.promptText
	return PARAMS
}

/**
 * 读取数据库中的原始配置值 (解析 ConfigValue).
 * 返回存储字符串; 缺失返回 null.
 */
export const getRaw = async (key: string): Promise<string | null> => {
	try {
		const RAW = await invoke<unknown>("get_config", {key})
		return extractValue(RAW)
	} catch {
		return null
	}
}

/**
 * 从 Tauri 命令返回中提取存储字符串.
 * get_config 返回的是 `ConfigValue` (untagged 枚举), 序列化时直接是该值本身:
 * 字符串→string / 整数→number / 布尔→boolean / JSON→object|array.
 * 这里把各种类型统一转成存储时的字符串
 */
export const extractValue = (raw: unknown): string | null => {
	if (raw === null || raw === undefined) return null
	if (typeof raw === "string") return raw
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
	// Json 变体 (数组 / 对象) 序列化后即为原始 JSON 值, 还原为压缩 JSON 文本
	return JSON.stringify(raw)
}

/**
 * 向数据库写入配置
 */
export const setRaw = async (key: string, value: string | number | boolean): Promise<void> => {
	await invoke("set_config", {key, value})
}

/**
 * 解析情绪列表 (稳健: 反序列化失败回退空数组; 老数据缺 promptLang 时回落默认语言)
 */
export const parseEmotions = async (raw: string | null): Promise<TTSVoiceEntry[]> => {
	if (!raw) return []
	try {
		const PARSED = JSON.parse(raw)
		if (Array.isArray(PARSED)) {
			return PARSED
				.map(item => {
					if (!item || typeof item !== "object") return null
					const NAME = String((item as Record<string, unknown>).name ?? "").trim()
					const AUDIO_PATH = String((item as Record<string, unknown>).audioPath ?? "").trim()
					const PROMPT_TEXT = String((item as Record<string, unknown>).promptText ?? "").trim()
					const PROMPT_LANG = String((item as Record<string, unknown>).promptLang ?? "zh").trim()
					if (!NAME) return null
					return {
						name: NAME,
						audioPath: AUDIO_PATH,
						promptText: PROMPT_TEXT,
						promptLang: toLang(PROMPT_LANG, "zh")
					}
				})
				.filter((item): item is TTSVoiceEntry => item !== null)
		}
		return []
	} catch (error) {
		await logger.error("解析 GPT-SoVITS 情绪列表失败", error)
		return []
	}
}

/**
 * 读取整份配置 (每次打开页面时调用)
 */
export const loadConfig = async (): Promise<GptSoVitsConfig> => {
	const DEFAULTS = defaultConfig()
	const [url, port, textLang, topK, topP, temperature, textSplitMethod, batchSize, emotions] =
		await Promise.all([
			getRaw(`${PREFIX}_url`),
			getRaw(`${PREFIX}_port`),
			getRaw(`${PREFIX}_text_lang`),
			getRaw(`${PREFIX}_top_k`),
			getRaw(`${PREFIX}_top_p`),
			getRaw(`${PREFIX}_temperature`),
			getRaw(`${PREFIX}_text_split_method`),
			getRaw(`${PREFIX}_batch_size`),
			getRaw(`${PREFIX}_emotions`),
		])
	return {
		url: url ?? DEFAULTS.url,
		port: port ?? DEFAULTS.port,
		textLang: toLang(textLang, DEFAULTS.textLang),
		topK: toNumber(topK, DEFAULTS.topK),
		topP: toNumber(topP, DEFAULTS.topP),
		temperature: toNumber(temperature, DEFAULTS.temperature),
		textSplitMethod: textSplitMethod ?? DEFAULTS.textSplitMethod,
		batchSize: toNumber(batchSize, DEFAULTS.batchSize),
		emotions: await parseEmotions(emotions),
	}
}

/**
 * 语言必须是可选值中的一员, 否则回落默认 (挡掉旧的 `auto` 等非法存入值)
 */
const toLang = (raw: string | null, fallback: string): string => {
	if (!raw) return fallback
	return GPT_SOVITS_LANGUAGES.includes(raw) ? raw : fallback
}

/**
 * 保存整份配置 (点击保存时调用, 情绪列表压缩为单行 JSON 存入数据库)
 */
export const saveConfig = async (config: GptSoVitsConfig): Promise<void> => {
	await Promise.all([
		setRaw(`${PREFIX}_url`, config.url.trim()),
		setRaw(`${PREFIX}_port`, config.port.trim()),
		setRaw(`${PREFIX}_text_lang`, config.textLang),
		setRaw(`${PREFIX}_top_k`, config.topK),
		setRaw(`${PREFIX}_top_p`, config.topP),
		setRaw(`${PREFIX}_temperature`, config.temperature),
		setRaw(`${PREFIX}_text_split_method`, config.textSplitMethod),
		setRaw(`${PREFIX}_batch_size`, config.batchSize),
		setRaw(`${PREFIX}_emotions`, JSON.stringify(config.emotions)),
	])
	await logger.info(`保存 GPT-SoVITS 配置: ${config.emotions.length} 个情绪`)
}

/**
 * 转数字 (兜底默认值)
 */
const toNumber = (raw: string | null, fallback: number): number => {
	if (!raw) return fallback
	const N = Number(raw)
	return Number.isFinite(N) ? N : fallback
}
