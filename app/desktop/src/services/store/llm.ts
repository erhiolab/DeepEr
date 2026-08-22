/**
 * LLM 状态管理 (适配器入口)
 */
import {ref} from "vue"
import {defineStore} from "pinia"
import {logger} from "../logger"
import {getActiveAdapterInstance} from "../llm/adapters"
import type {LLMGenerateRequest, LLMGenerateResult, LLMTestResult} from "../llm/types"

/**
 * LLM 适配器状态
 */
export const useLLMStore = defineStore("llm", () => {
	// 当前激活的适配器名称 (null = 未启用)
	const activeAdapterName = ref<string | null>(null)

	// 是否已初始化 (读到激活适配器)
	const initialized = ref(false)

	// 是否正在生成
	const generating = ref(false)

	// 上一次生成结果 (供 UI / AI 查询)
	const lastResult = ref<LLMGenerateResult | null>(null)

	// 是否正在测试连接
	const testing = ref(false)

	/**
	 * 初始化: 读取当前激活适配器 (幂等, 不报错).
	 */
	const init = async (): Promise<void> => {
		const ADAPTER = await getActiveAdapterInstance()
		activeAdapterName.value = ADAPTER ? ADAPTER.label : null
		initialized.value = true
	}

	/**
	 * 生成 (统一入口). 未启用适配器时返回失败结果.
	 *
	 * @param request 统一生成请求
	 */
	const generate = async (request: LLMGenerateRequest): Promise<LLMGenerateResult> => {
		generating.value = true
		try {
			const ADAPTER = await getActiveAdapterInstance()
			if (!ADAPTER) {
				lastResult.value = {ok: false, error: "LLM 未启用"}
			} else {
				lastResult.value = await ADAPTER.generate(request).catch(error => {
					const REASON = typeof error === "string" && error.trim() ? error.trim() : "LLM 生成失败"
					return {ok: false, error: REASON}
				})
			}
			return lastResult.value
		} catch (error) {
			await logger.error("LLM store generate 异常", error)
			lastResult.value = {ok: false, error: String(error)}
			return lastResult.value
		} finally {
			generating.value = false
		}
	}

	/**
	 * 测试当前适配器 (需先在页面保存配置, 此处由适配器按已保存配置请求)
	 */
	const testConnection = async (): Promise<LLMTestResult | null> => {
		const ADAPTER = await getActiveAdapterInstance()
		if (!ADAPTER) return null
		testing.value = true
		try {
			return await ADAPTER.testConnection()
		} finally {
			testing.value = false
		}
	}

	return {
		activeAdapterName,
		initialized,
		generating,
		lastResult,
		testing,
		init,
		generate,
		testConnection,
	}
})
