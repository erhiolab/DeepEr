/**
 * GPT-SoVITS 适配器
 */
import {invoke} from "@tauri-apps/api/core"
import useLanguages from "../i18n/useLanguages"
import {logger} from "../logger"
import {config} from "../config"
import type {
	TTSAdapter,
	TTSVoiceEntry,
	TtsSynthesizeRequest,
	TtsSynthesizeResult,
	TtsTestResult,
	TTSVoiceInfo
} from "./types"

/**
 * 合成/参考语言可选值
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
 * 把后端 TTS 错误码翻译为用户可读文案
 */
const translateTtsError = (code?: string, fallback?: string): string => {
	if (!code) return fallback ?? "TTS 合成失败"
	const ERRORS = useLanguages().errors
	switch (code) {
		case "empty_text":
			return ERRORS.emptyText
		case "missing_voice":
			return ERRORS.missingVoice
		case "network_error":
			return ERRORS.networkError
		case "http_error":
			return ERRORS.httpError()
		case "empty_audio":
			return ERRORS.emptyAudio
		default:
			return fallback ?? "TTS 合成失败"
	}
}

/**
 * GPT-SoVITS 完整配置 (与前端表单对应)
 */
export interface GptSoVitsConfig {
	baseUrl: string
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
		baseUrl: "http://127.0.0.1:9880",
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
 * 归一化服务地址: 去掉首尾空白, 自动补全 http:// 前缀
 */
export const normalizeBaseUrl = (raw: string): string => {
	const TRIMMED = raw.trim()
	if (!TRIMMED) return "http://127.0.0.1:9880"
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(TRIMMED)) return TRIMMED
	return `http://${TRIMMED}`
}

/**
 * 解析情绪列表
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
						promptLang: toLang(PROMPT_LANG, "zh"),
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
 * 语言必须是可选值中的一员, 否则回落默认
 */
const toLang = (raw: string | null, fallback: string): string => {
	if (!raw) return fallback
	return GPT_SOVITS_LANGUAGES.includes(raw) ? raw : fallback
}

/**
 * 转数字 (兜底默认值)
 */
const toNumber = (raw: string | null, fallback: number): number => {
	if (!raw) return fallback
	const N = Number(raw)
	return Number.isFinite(N) ? N : fallback
}

/**
 * 读取整份配置
 */
export const loadConfig = async (): Promise<GptSoVitsConfig> => {
	const DEFAULTS = defaultConfig()
	const [baseUrl, textLang, topK, topP, temperature, textSplitMethod, batchSize, emotions] =
		await Promise.all([
			config.getRaw(`${PREFIX}_base_url`),
			config.getRaw(`${PREFIX}_text_lang`),
			config.getRaw(`${PREFIX}_top_k`),
			config.getRaw(`${PREFIX}_top_p`),
			config.getRaw(`${PREFIX}_temperature`),
			config.getRaw(`${PREFIX}_text_split_method`),
			config.getRaw(`${PREFIX}_batch_size`),
			config.getRaw(`${PREFIX}_emotions`),
		])
	return {
		baseUrl: baseUrl ?? DEFAULTS.baseUrl,
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
 * 保存整份配置
 */
export const saveConfig = async (cfg: GptSoVitsConfig): Promise<void> => {
	await Promise.all([
		config.setRaw(`${PREFIX}_base_url`, normalizeBaseUrl(cfg.baseUrl)),
		config.setRaw(`${PREFIX}_text_lang`, cfg.textLang),
		config.setRaw(`${PREFIX}_top_k`, cfg.topK),
		config.setRaw(`${PREFIX}_top_p`, cfg.topP),
		config.setRaw(`${PREFIX}_temperature`, cfg.temperature),
		config.setRaw(`${PREFIX}_text_split_method`, cfg.textSplitMethod),
		config.setRaw(`${PREFIX}_batch_size`, cfg.batchSize),
		config.setRaw(`${PREFIX}_emotions`, JSON.stringify(cfg.emotions)),
	])
	await logger.info(`保存 GPT-SoVITS 配置: ${cfg.emotions.length} 个情绪`)
}

/**
 * GPT-SoVITS 适配器实现
 */
export const gptSovitsAdapter: TTSAdapter<GptSoVitsConfig> = {
	id: "gpt-sovits",
	label: "GPT-SoVITS",
	description: "本地部署的开源克隆音色引擎 (API V2, 需参考音频)",
	async loadConfig() {
		return await loadConfig()
	},
	async saveConfig(cfg) {
		await saveConfig(cfg)
	},
	async testConnection(): Promise<TtsTestResult> {
		// 后端自读配置并请求平台, 返回 HTTP 状态码
		try {
			const STATUS = await invoke<number>("tts_gptsovits_test_connection")
			return {ok: true, status: STATUS}
		} catch (error) {
			return {ok: false, error: typeof error === "string" ? error : String(error)}
		}
	},
	async synthesize(request: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> {
		const CFG = await this.loadConfig()
		if (!CFG.emotions.length) {
			return {ok: false, error: "尚未配置任何音色(参考音频)"}
		}
		try {
			const RESULT = await invoke<{
				ok: boolean
				assetPath?: string
				fileName?: string
				error?: string
				errorCode?: string
			}>("tts_gptsovits_synthesize", {
				args: {
					text: request.text,
					...(request.voice?.trim() ? {voice: request.voice.trim()} : {}),
				},
			})
			if (!RESULT.ok) {
				return {ok: false, error: translateTtsError(RESULT.errorCode, RESULT.error)}
			}
			return {
				ok: true,
				audioAssetPath: RESULT.assetPath,
				fileName: RESULT.fileName,
			}
		} catch (error) {
			const REASON = typeof error === "string" && error.trim() ? error.trim() : "TTS 合成失败"
			await logger.error("GPT-SoVITS 合成失败", error)
			return {ok: false, error: REASON}
		}
	},
	async listVoices(): Promise<TTSVoiceInfo[]> {
		const CFG = await this.loadConfig()
		return CFG.emotions.map(entry => ({
			name: entry.name,
			description: entry.audioPath || undefined,
		}))
	},
	async buildAIParamsPrompt(): Promise<string | null> {
		const CFG = await this.loadConfig()
		if (!CFG.emotions.length) {
			return null
		}
		const VOICE_LIST = CFG.emotions.map(entry => entry.name).join("/")
		const LANGUAGE_LIST = GPT_SOVITS_LANGUAGES.join("/")
		return [
			"你是 GPT-SoVITS 语音合成参数助手. 用户会给你一段要朗读的文本, 请根据文本的语气选择合适的音色. ",
			`可用音色(参考音频): ${VOICE_LIST}`,
			`语言可选 ${LANGUAGE_LIST}; 无法确定的字段省略. `,
			"只输出一个 JSON 对象, 不要输出任何其他文字. ",
			'格式: {"voice": "音色名", "language": "zh"}',
			`规则: voice 必须来自上面的可用音色列表; language 可选 ${LANGUAGE_LIST}; 无法确定的字段省略. `,
		].join("\n")
	},
	parseAIParams<T extends Pick<TtsSynthesizeRequest, "voice" | "language" | "speed">>(raw: string, voices: TTSVoiceInfo[]): T {
		let text = raw.trim()
		const FENCE = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
		if (FENCE) text = FENCE[1].trim()
		const START = text.indexOf("{")
		const END = text.lastIndexOf("}")
		if (START === -1 || END <= START) return {} as T
		try {
			const OBJ = JSON.parse(text.slice(START, END + 1)) as Record<string, unknown>
			const OUT: Pick<TtsSynthesizeRequest, "voice" | "language" | "speed"> = {}
			const VOICE = String(OBJ.voice ?? "").trim()
			// 音色必须来自参考音频列表 (GPT-SoVITS 由用户配置)
			if (VOICE && voices.some(v => v.name === VOICE)) OUT.voice = VOICE
			const LANG = String(OBJ.language ?? "").trim()
			// 语言必须是 GPT-SoVITS 支持值之一
			if (LANG && GPT_SOVITS_LANGUAGES.includes(LANG)) OUT.language = LANG
			return OUT as T
		} catch {
			return {} as T
		}
	},
}
