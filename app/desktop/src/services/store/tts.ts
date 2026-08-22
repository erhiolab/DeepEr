/**
 * TTS 状态管理 (适配器入口)
 */
import {computed, ref} from "vue"
import {defineStore} from "pinia"
import {logger} from "../logger"
import {getActiveAdapterInstance} from "../tts/adapters"
import type {TtsSynthesizeRequest, TtsSynthesizeResult, TtsTestResult, TTSVoiceInfo} from "../tts/types"

/**
 * TTS 适配器状态
 */
export const useTTSStore = defineStore("tts", () => {
	// 当前激活的适配器实例 (null = 未启用)
	const activeAdapter = ref<Awaited<ReturnType<typeof getActiveAdapterInstance>>>(null)

	// 是否已初始化 (读到激活适配器)
	const initialized = ref(false)

	// 上一次合成结果 (供 UI / AI 查询)
	const lastResult = ref<TtsSynthesizeResult | null>(null)

	// 是否正在合成
	const synthesizing = ref(false)

	// 是否正在测试连接
	const testing = ref(false)

	// 当前可用音色
	const voices = ref<TTSVoiceInfo[]>([])

	// 当前是否有可用音色
	const hasVoices = computed(() => voices.value.length > 0)

	/**
	 * 初始化: 读取当前激活适配器并加载其音色列表.
	 * 尚未启用任何适配器时, activeAdapter = null (幂等, 不报错).
	 */
	const init = async (): Promise<void> => {
		activeAdapter.value = await getActiveAdapterInstance()
		initialized.value = true
		if (activeAdapter.value) {
			await refreshVoices()
		}
	}

	/**
	 * 读取当前激活适配器的音色列表 (每次切换适配器 / 保存配置后调用)
	 */
	const refreshVoices = async (): Promise<void> => {
		const ADAPTER = activeAdapter.value
		if (!ADAPTER || typeof ADAPTER.listVoices !== "function") {
			voices.value = []
			return
		}
		try {
			voices.value = await ADAPTER.listVoices()
		} catch (error) {
			await logger.error("读取 TTS 音色列表失败", error)
			voices.value = []
		}
	}

	/**
	 * 合成一段语音 (统一入口).
	 * 未启用适配器 / 无音色可用时返回失败结果.
	 *
	 * @param request 统一合成请求
	 */
	const synthesize = async (request: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> => {
		const ADAPTER = activeAdapter.value
		if (!ADAPTER) {
			lastResult.value = {ok: false, error: "TTS 未启用"}
			return lastResult.value
		}
		synthesizing.value = true
		try {
			lastResult.value = await ADAPTER.synthesize(request)
			return lastResult.value
		} catch (error) {
			const REASON = typeof error === "string" && error.trim() ? error.trim() : "TTS 合成失败"
			lastResult.value = {ok: false, error: REASON}
			return lastResult.value
		} finally {
			synthesizing.value = false
		}
	}

	/**
	 * 测试当前适配器的连接状态 (统一入口)
	 */
	const testConnection = async (): Promise<TtsTestResult | null> => {
		const ADAPTER = activeAdapter.value
		if (!ADAPTER) return null
		testing.value = true
		try {
			return await ADAPTER.testConnection()
		} finally {
			testing.value = false
		}
	}

	return {
		activeAdapter,
		initialized,
		lastResult,
		synthesizing,
		testing,
		voices,
		hasVoices,
		init,
		refreshVoices,
		synthesize,
		testConnection,
	}
})
