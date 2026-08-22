/**
 * TTS 适配器注册表
 *
 * 统一的「多适配器」入口: 这里决定当前支持哪些平台.
 * 新增适配器时:
 *   1. 在 `types.ts` 的 TTSAdapterId 中加入新 id
 *   2. 在此注册一个 Definition (label/description)
 *   3. 在 `TTSAdapter.vue` 中按 id 挂载对应的配置面板组件
 *   4. 自备一套 `<id>_*` 前缀的配置键与读写 service
 * 同一时间仅激活一个适配器, 激活状态存 `tts_adapter` 配置键.
 * 听清楚了吗!!
 */
import {config} from "../config"
import {logger} from "../logger"
import type {TTSAdapterDefinition, TTSAdapterId} from "./types"

/**
 * 全局配置键: 当前启用的适配器 id (存 `none` 表示不启用)
 */
export const TTS_ADAPTER_KEY = "tts_adapter"

/**
 * 不启用的特殊值
 */
export const TTS_ADAPTER_DISABLED = "none"

/**
 * 全部已实现适配器
 */
export const TTS_ADAPTERS: TTSAdapterDefinition[] = [
	{
		id: "gpt-sovits",
		label: "GPT-SoVITS",
		description: "本地部署的开源克隆音色引擎 (API V2, 需参考音频)",
	},
	// 未来在此追加其它适配器定义, 例如:
	// { id: "edge-tts", label: "Edge TTS", description: "微软在线多语音" },
]

/**
 * 当前启用的适配器 id; `null` 表示不启用 (读取数据库, 缺失/非法回退为不启用)
 */
export const getActiveAdapter = async (): Promise<TTSAdapterId | null> => {
	const SAVED = await config.get(TTS_ADAPTER_KEY)
	if (SAVED && SAVED !== TTS_ADAPTER_DISABLED && TTS_ADAPTERS.some(adapter => adapter.id === SAVED)) {
		return SAVED as TTSAdapterId
	}
	return null
}

/**
 * 启用指定适配器 / 传 `null` 表示不启用 (单选, 同时仅一个生效)
 *
 * @param id 适配器 id, 或 `null` 表示不启用
 */
export const setActiveAdapter = async (id: TTSAdapterId | null): Promise<void> => {
	if (id !== null && !TTS_ADAPTERS.some(adapter => adapter.id === id)) return
	const VALUE = id === null ? TTS_ADAPTER_DISABLED : id
	await config.set(TTS_ADAPTER_KEY, VALUE)
	await logger.info(`设置 TTS 适配器: ${VALUE}`)
}
