/**
 * TTS 适配器注册表
 *
 * 统一的'多适配器'入口: 这里持有全部已实现的适配器实例,
 * 并通过 `useTTSStore` 暴露对外统一协议 (synthesize / testConnection / listVoices).
 *
 * 新增适配器时:
 *   1. 在 `types.ts` 的 TTSAdapterId 中加入新 id
 *   2. 实现 `TTSAdapter` 接口 (封装自己的平台协议)
 *   3. 把实例加入 `TTS_ADAPTERS`
 *   4. 在 `TTSAdapter.vue` 中按 id 挂载对应的配置面板组件
 * 同一时间仅激活一个适配器, 激活状态存 `tts_adapter` 配置键.
 */
import {config} from "../config"
import {logger} from "../logger"
import {gptSovitsAdapter} from "./gptsovits"
import type {TTSAdapter, TTSAdapterId} from "./types"

/**
 * 全局配置键: 当前启用的适配器 id (存 `none` 表示不启用)
 */
export const TTS_ADAPTER_KEY = "tts_adapter"

/**
 * 不启用的特殊值
 */
export const TTS_ADAPTER_DISABLED = "none"

/**
 * 全部已实现的适配器实例
 */
export const TTS_ADAPTERS: TTSAdapter[] = [
	gptSovitsAdapter,
	// 未来在此追加其它适配器实例
]

/**
 * 按 id 查找适配器实例
 *
 * @param id 适配器 id
 * @returns 适配器实例; 未找到返回 null
 */
export const getAdapter = (id: TTSAdapterId): TTSAdapter | null => TTS_ADAPTERS.find(adapter => adapter.id === id) ?? null

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
 * 获取当前激活的适配器实例; 未启用时返回 null
 */
export const getActiveAdapterInstance = async (): Promise<TTSAdapter | null> => {
	const ID = await getActiveAdapter()
	return ID ? getAdapter(ID) : null
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
