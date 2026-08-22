/**
 * GPT-SoVITS 适配器
 * 服务端 API 版本: V2, 接口: GET {base}/tts
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"
import {config} from "../config"
import type {TTSAdapter, TTSVoiceEntry} from "./types"

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
 * 归一化服务地址: 去掉首尾空白, 自动补全 http:// 前缀 (防止 reqwest `builder error`)
 */
export const normalizeBaseUrl = (raw: string): string => {
	const TRIMMED = raw.trim()
	if (!TRIMMED) return "http://127.0.0.1:9880"
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(TRIMMED)) return TRIMMED
	return `http://${TRIMMED}`
}

/**
 * 返回归一化后的 base 地址, 例: http://127.0.0.1:9880
 */
export const buildBaseUrl = (cfg: Pick<GptSoVitsConfig, "baseUrl">): string => {
	return normalizeBaseUrl(cfg.baseUrl)
}

/**
 * 拼接 /tts 完整地址
 */
export const buildTtsUrl = (cfg: Pick<GptSoVitsConfig, "baseUrl">): string => {
	return `${buildBaseUrl(cfg)}/tts`
}

/**
 * 构造一次合成请求的查询参数
 */
export const buildParams = (config: Pick<GptSoVitsConfig, "textLang" | "topK" | "topP" | "temperature" | "textSplitMethod" | "batchSize">, text: string, entry: TTSVoiceEntry,): Record<string, unknown> => {
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
 * 解析情绪列表 (稳健: 反序列化失败回退空数组, 老数据缺 promptLang 时回落默认语言)
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
	async testConnection() {
		// 404 是根路径无映射但服务健康, 5xx 是服务在线但网关异常, 都算连通.
		const URL = buildBaseUrl(await this.loadConfig())
		try {
			const STATUS = await invoke<number>("tts_test_connection", {url: URL})
			return {ok: true, status: STATUS}
		} catch (error) {
			// 网络层错误 (连接被拒/超时/DNS 失败) 才真正说明不可达
			return {ok: false, error: typeof error === "string" ? error : String(error)}
		}
	},
	async synthesize(request) {
		const CONFIG = await this.loadConfig()
		const ENTRY = findVoice(CONFIG, request.voice)
		if (!ENTRY) {
			return {ok: false, error: `未找到音色: ${request.voice ?? "(未指定)"}`}
		}
		const PARAMS = buildParams(CONFIG, request.text, ENTRY)
		try {
			const RESULT = await invoke<{ assetPath: string; fileName: string }>("tts_synthesize", {
				url: buildTtsUrl(CONFIG),
				params: PARAMS,
				extension: "wav",
			})
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
	async listVoices() {
		const CONFIG = await this.loadConfig()
		return CONFIG.emotions.map(entry => ({
			name: entry.name,
			description: entry.audioPath || undefined,
		}))
	},
}

/**
 * 在配置中按音色名查找参考音频, 未指定时用第一条 (若存在).
 */
const findVoice = (config: GptSoVitsConfig, voice?: string): TTSVoiceEntry | undefined => {
	if (voice && voice.trim()) {
		const NAME = voice.trim()
		return config.emotions.find(entry => entry.name === NAME)
	}
	return config.emotions[0]
}
