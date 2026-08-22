/**
 * LLM 适配器注册表
 *
 * 统一'多适配器'入口: 这里持有全部已实现的适配器实例,
 * 并通过 `useLLMStore` 暴露对外统一协议 (generate / testConnection).
 *
 * 新增适配器时:
 *   1. 在 `types.ts` 的 LLMAdapterId 中加入新 id
 *   2. 实现 `LLMAdapter` 接口 (封装自己的平台协议)
 *   3. 把实例加入 `LLM_ADAPTERS`
 *   4. 在 `LLMAdapter.vue` 中按 id 挂载对应的配置面板组件
 * 同一时间仅激活一个适配器, 激活状态存 `llm_adapter` 配置键.
 */
import {config} from "../config"
import {logger} from "../logger"
import {anthropicMessagesAdapter} from "./anthropic"
import {googleGenAiAdapter} from "./googlegenai"
import {openAiResponsesAdapter} from "./openairesponses"
import type {LLMAdapter, LLMAdapterId} from "./types"

/**
 * 全局配置键: 当前启用的适配器 id (存 `none` 表示不启用)
 */
export const LLM_ADAPTER_KEY = "llm_adapter"

/**
 * 不启用的特殊值
 */
export const LLM_ADAPTER_DISABLED = "none"

/**
 * 全部已实现的适配器实例
 */
export const LLM_ADAPTERS: LLMAdapter[] = [
	openAiResponsesAdapter,
	anthropicMessagesAdapter,
	googleGenAiAdapter,
	// 未来在此追加其它适配器实例
]

/**
 * 按 id 查找适配器实例
 *
 * @param id 适配器 id
 * @returns 适配器实例; 未找到返回 null
 */
export const getAdapter = (id: LLMAdapterId): LLMAdapter | null => LLM_ADAPTERS.find(adapter => adapter.id === id) ?? null

/**
 * 当前启用的适配器 id; `null` 表示不启用 (读取数据库, 缺失/非法回退为不启用)
 */
export const getActiveAdapter = async (): Promise<LLMAdapterId | null> => {
	const SAVED = await config.get(LLM_ADAPTER_KEY)
	if (SAVED && SAVED !== LLM_ADAPTER_DISABLED && LLM_ADAPTERS.some(adapter => adapter.id === SAVED)) {
		return SAVED as LLMAdapterId
	}
	return null
}

/**
 * 获取当前激活的适配器实例; 未启用时返回 null
 */
export const getActiveAdapterInstance = async (): Promise<LLMAdapter | null> => {
	const ID = await getActiveAdapter()
	return ID ? getAdapter(ID) : null
}

/**
 * 启用指定适配器 / 传 `null` 表示不启用 (单选, 同时仅一个生效)
 *
 * @param id 适配器 id, 或 `null` 表示不启用
 */
export const setActiveAdapter = async (id: LLMAdapterId | null): Promise<void> => {
	if (id !== null && !LLM_ADAPTERS.some(adapter => adapter.id === id)) return
	const VALUE = id === null ? LLM_ADAPTER_DISABLED : id
	await config.set(LLM_ADAPTER_KEY, VALUE)
	await logger.info(`设置 LLM 适配器: ${VALUE}`)
}
