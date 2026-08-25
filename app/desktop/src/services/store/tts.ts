/**
 * TTS 状态管理 (适配器入口)
 */
import {computed, ref} from "vue"
import {defineStore} from "pinia"
import {logger} from "../logger"
import {contextInsert, estimateTokens} from "../context"
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
	 * 把一段可能带 Markdown 标记的文本清洗成适合朗读的纯文本.
	 * 代码块 / 裸链接整体移除, 行内代码与链接保留文字, 其余 md 标记剥离.
	 */
	const cleanSpeechText = (raw: string): string => {
		let text = raw
		// 代码块整体移除 (代码不适合朗读)
		text = text.replace(/```[\s\S]*?```/g, " ")
		// 行内代码保留内容
		text = text.replace(/`([^`\n]*)`/g, "$1")
		// 链接 / 图片: 保留显示文字
		text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		// 裸链接移除
		text = text.replace(/https?:\/\/\S+/g, " ")
		// 标题 / 引用 / 列表标记
		text = text.replace(/^#{1,6}\s+/gm, "")
		text = text.replace(/^\s{0,3}>\s?/gm, "")
		text = text.replace(/^\s{0,3}([-*+]\s|\d{1,9}[.、]\s)/gm, "")
		// 粗体 / 斜体 / 下划线 / 删除线
		text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		text = text.replace(/\*([^*\n]+)\*/g, "$1")
		text = text.replace(/__([^_\n]+)__/g, "$1")
		text = text.replace(/~~([^~\n]+)~~/g, "$1")
		// 表格分隔线
		text = text.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
		return text.replace(/\s+/g, " ").trim()
	}

	/**
	 * 开一次性的 LLM 调用, 让 AI 根据消息内容决定 TTS 参数.
	 */
	const decideParamsByAI = async (text: string): Promise<{
		params: Pick<TtsSynthesizeRequest, "voice" | "speed" | "language">
		inputTokens: number
		outputTokens: number
	}> => {
		const EMPTY_RESULT = {params: {}, inputTokens: 0, outputTokens: 0}
		const ADAPTER = activeAdapter.value
		if (!ADAPTER || typeof ADAPTER.buildAIParamsPrompt !== "function" || typeof ADAPTER.parseAIParams !== "function") {
			return EMPTY_RESULT
		}
		try {
			const PROMPT = await ADAPTER.buildAIParamsPrompt()
			if (!PROMPT) return EMPTY_RESULT
			// 动态导入避免循环依赖
			const {useLLMStore} = await import("./llm")
			const LLM = useLLMStore()
			// 与聊天同用 generateStream(流式)后端路径, 以确保返回真实的输入/输出 token
			const RESULT = await LLM.generateStream({
				messages: [
					{role: "system", content: PROMPT},
					{role: "user", content: text},
				],
				temperature: 0.2,
				maxTokens: 200,
			})
			if (!RESULT.ok || !RESULT.text) return EMPTY_RESULT
			return {
				params: ADAPTER.parseAIParams<Pick<TtsSynthesizeRequest, "voice" | "speed" | "language">>(RESULT.text, voices.value),
				inputTokens: RESULT.inputTokens ?? 0,
				outputTokens: RESULT.outputTokens ?? 0,
			}
		} catch (error) {
			await logger.error("TTS AI 调参失败, 回落默认参数", error)
			return EMPTY_RESULT
		}
	}

	/**
	 * 确保激活适配器与最新配置一致: 每次都重新读取, 避免配置变更(启用/关闭)后缓存滞后
	 */
	const ensureInit = async (): Promise<void> => {
		activeAdapter.value = await getActiveAdapterInstance()
		initialized.value = true
	}

	/**
	 * 正常调用入口: 传入一段消息文本, 先由一次性 AI 决定 TTS 参数, 再合成语音.
	 * 每次调用都会重新读取激活适配器, 因此关闭/切换 TTS 后立即生效, 不会滞后.
	 *
	 * @param text 要朗读的消息文本 (允许带 Markdown, 会先清洗成纯文本)
	 */
	const speak = async (text: string): Promise<TtsSynthesizeResult> => {
		const CLEAN_TEXT = cleanSpeechText(text)
		if (!CLEAN_TEXT) {
			lastResult.value = {ok: false, error: "TTS 文本为空"}
			return lastResult.value
		}
		// 每次重新读取激活适配器 (关闭后这里会读到 null, 从而不再触发)
		await ensureInit()
		if (!activeAdapter.value) {
			lastResult.value = {ok: false, error: "TTS 未启用"}
			return lastResult.value
		}
		const AI = await decideParamsByAI(CLEAN_TEXT)
		// 记录 TTS 请求, 和聊天一样带角色与输入/输出 token:
		// 输入条 (type=tts, role=user, content=合成文本, token=输入 token)
		void contextInsert({
			type: "tts",
			role: "user",
			content: CLEAN_TEXT,
			tokenCount: AI.inputTokens || estimateTokens(CLEAN_TEXT),
		})
		// 输出条 (type=tts, role=assistant, content=这次选用的参数, token=输出 token)
		const PARAM_TEXT = Object.entries(AI.params)
			.filter(([, v]) => v !== undefined && v !== null && v !== "")
			.map(([k, v]) => `${k}=${v}`)
			.join(" ")
		void contextInsert({
			type: "tts",
			role: "assistant",
			content: PARAM_TEXT || "(tts)",
			tokenCount: AI.outputTokens || estimateTokens(PARAM_TEXT || "tts"),
		})
		return await synthesize({text: CLEAN_TEXT, ...AI.params})
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
		speak,
		testConnection,
	}
})
