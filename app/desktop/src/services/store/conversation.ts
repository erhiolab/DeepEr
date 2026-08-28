/**
 * AI 对话状态 (统一承载聊天界面 / 桌宠气泡 / 触摸请求的数据源)
 *
 * 架构约定:
 * - context 表是唯一事实源: 人设 (type=person) / 对话 (talk) / 触摸 (touch) 都在库里,
 *   每次请求从库里构建上下文, 不再前端临时拼装.
 * - 一次请求 = 构建上下文 (算命中率) → LLM 流式生成 → 记录真实 input/output token → TTS 朗读.
 * - TTS 统一走 useTTSStore().speak (内部负责 md 清洗 / AI 调参 / 记录 tts 上下文).
 * - 后续 MCP / 技能 / 工具接入时, 扩展 buildTalkMessages 的上下文类型即可.
 */
import {computed, reactive, ref} from "vue"
import {defineStore} from "pinia"
import {assetUrl} from "../asset"
import {contextInsert, contextList, estimateTokens} from "../context"
import {logger} from "../logger"
import type {Persona} from "../persona"

/**
 * 对话消息方向
 * - left  : 对方 / AI 消息
 * - right : 用户自己的消息
 * - center: 中间信息 (时间分隔 / 系统状态), 仅聊天界面展示, 桌宠不展示
 */
export type ChatSide = "left" | "right" | "center"

/**
 * 一条对话消息
 */
export interface ChatMessage {
	id: number
	side: ChatSide
	text: string
	createdAt: number
	isStreaming?: boolean
}

/**
 * AI 对话状态
 */
export const useConversationStore = defineStore("conversation", () => {
	// 完整对话历史
	const HISTORY = ref<ChatMessage[]>([])

	// 消息 id 自增
	let nextId = 1

	// 是否已从 context 表回显过历史 (每个 store 实例只回显一次, 切换窗口不重复)
	let historyLoaded = false

	// 回显历史条数上限 (最近 N 条 type=talk 记录)
	const HISTORY_RELOAD_LIMIT = 50

	// 生成一条消息并写入历史 (消息为响应式对象, 便于流式中文本增量更新)
	const push = (side: ChatSide, text: string, isStreaming = false): ChatMessage => {
		const MSG = reactive<ChatMessage>({id: nextId++, side, text, createdAt: Date.now(), isStreaming}) as ChatMessage
		HISTORY.value = [...HISTORY.value, MSG]
		return MSG
	}

	// 对方是否正在输入/加载
	const isTyping = ref(false)

	// 输入状态自动复位的兜底超时
	const TYPING_TIMEOUT_MS = 60_000

	let typingTimer: ReturnType<typeof setTimeout> | null = null

	// 清除超时定时器
	const clearTypingTimer = () => {
		if (typingTimer) {
			clearTimeout(typingTimer)
			typingTimer = null
		}
	}

	/**
	 * 设置"对方正在输入/加载"状态
	 * 置为 true 时开启超时兜底 (超时自动复位), 置为 false 立即结束
	 */
	const setTyping = (v: boolean) => {
		clearTypingTimer()
		if (v) {
			isTyping.value = true
			typingTimer = setTimeout(() => {
				isTyping.value = false
				typingTimer = null
			}, TYPING_TIMEOUT_MS)
		} else {
			isTyping.value = false
		}
	}

	/**
	 * 插入左边 (对方 / AI) 的消息
	 */
	const pushLeft = (text: string): ChatMessage => {
		const MSG = push("left", text)
		setTyping(false)
		return MSG
	}

	/**
	 * 插入右边 (用户自己) 的消息
	 */
	const pushRight = (text: string): ChatMessage => push("right", text)

	/**
	 * 插入中间信息 (时间分隔 / 系统状态)
	 */
	const pushCenter = (text: string): ChatMessage => push("center", text)

	// LLM 对话消息类型
	type LLMMsg = {role: "user" | "assistant" | "system", content: string}

	// 给 LLM 的上下文 token 预算 (从 context 表取最近历史的累计上限)
	const CONTEXT_TOKEN_BUDGET = 8000

	/**
	 * 构建本次 LLM 请求的上下文
	 *
	 * 从 context 表读取:
	 * - type=person: 当前人设 (system 消息, 恒在最前, 不参与预算裁剪)
	 * - type=talk / touch: 对话历史, 按 token 预算从最新向前累积, 得到时间正序
	 *
	 * 返回消息列表与上下文命中率 (实际用到的 token / 库中上下文 token).
	 */
	const buildTalkMessages = async (): Promise<{messages: LLMMsg[], hitRate: number}> => {
		const RECORDS = await contextList(200, 0)
		const PERSON = RECORDS.filter(record => record.type === "person" && record.content.trim())
		const TALK = RECORDS
			.filter(record => (record.type === "talk" || record.type === "touch") && record.role && record.content.trim())
			.reverse() // 旧 -> 新

		const MESSAGES: LLMMsg[] = []
		let used = 0
		let total = 0
		for (const record of TALK) {
			total += record.tokenCount || estimateTokens(record.content)
		}
		// 从最新向前累积, 直到预算耗尽
		for (const record of [...TALK].reverse()) {
			const COST = record.tokenCount || estimateTokens(record.content)
			if (MESSAGES.length && used + COST > CONTEXT_TOKEN_BUDGET) break
			used += COST
			MESSAGES.push({
				role: record.role === "assistant" ? "assistant" : "user",
				content: record.content,
			})
		}
		const HISTORY = MESSAGES.reverse()

		// 人设系统消息恒在最前, 不参与预算裁剪
		for (const person of PERSON.reverse()) {
			const COST = person.tokenCount || estimateTokens(person.content)
			used += COST
			total += COST
			HISTORY.unshift({role: "system", content: person.content})
		}

		const hitRate = total > 0 ? Math.min(1, used / total) : 1
		return {messages: HISTORY, hitRate}
	}

	// 播放一段已合成的音频
	const playAudioAsset = (audioAssetPath: string): Promise<void> =>
		new Promise<void>((resolve) => {
			const AUDIO = new Audio(assetUrl(audioAssetPath))
			const DONE = () => {
				AUDIO.removeEventListener("ended", DONE)
				AUDIO.removeEventListener("error", DONE)
				resolve()
			}
			AUDIO.addEventListener("ended", DONE)
			AUDIO.addEventListener("error", DONE)
			// autoplay 被拦截时同样当作播放完成
			AUDIO.play().catch(DONE)
		})

	// 朗读一段回复: 统一走 TTS store (内部负责 md 清洗 / AI 调参 / 记录 tts 上下文 token)
	const speakReply = async (text: string): Promise<void> => {
		try {
			const {useTTSStore} = await import("./tts")
			const RESULT = await useTTSStore().speak(text)
			if (RESULT.ok && RESULT.audioAssetPath) await playAudioAsset(RESULT.audioAssetPath)
		} catch (error) {
			await logger.error("[conversation] TTS 朗读失败", error)
		}
	}

	/**
	 * 触发一次 AI 回复
	 *
	 * 流式渲染全文 (不再分词), 结束后记录真实 input/output token 与上下文命中率,
	 * 然后整体交给 TTS 朗读.
	 */
	const requestLLM = (context: {messages: LLMMsg[], hitRate: number}, onDone?: () => void) => {
		// 上下文为空 (例如库异常) 时不发起请求, 避免平台返回空消息 400
		if (context.messages.length === 0) {
			pushLeft("上下文为空, 请先发送一条消息")
			onDone?.()
			return
		}
		const MSG = push("left", "")
		MSG.isStreaming = true
		setTyping(true)
		void (async () => {
			try {
				// 动态导入避免循环依赖
				const {useLLMStore} = await import("./llm")
				const RESULT = await useLLMStore().generateStream({messages: context.messages}, (delta) => {
					if (delta) MSG.text += delta
				})
				MSG.isStreaming = false
				setTyping(false)
				if (RESULT.ok && RESULT.text) {
					// 兜底补齐完整文本 (事件缺失时)
					MSG.text = RESULT.text
					// 记录 AI 回复 (真实 token + 上下文命中率)
					void contextInsert({
						type: "talk",
						role: "assistant",
						content: RESULT.text,
						tokenCount: RESULT.outputTokens ?? estimateTokens(RESULT.text),
						inputTokens: RESULT.inputTokens,
						outputTokens: RESULT.outputTokens,
						hitRate: context.hitRate,
					})
					// 回复完成后朗读全文
					void speakReply(RESULT.text)
				} else {
					MSG.text = RESULT.error || "生成失败"
					// 失败也记录到上下文, 便于排查 (真实 token 缺失时用估算)
					void contextInsert({
						type: "talk",
						role: "assistant",
						content: MSG.text,
						tokenCount: estimateTokens(MSG.text),
						hitRate: context.hitRate,
					})
				}
				onDone?.()
			} catch (err) {
				await logger.error("conversation LLM 请求异常", err)
				MSG.isStreaming = false
				setTyping(false)
				MSG.text = String(err)
				onDone?.()
			}
		})()
	}

	/**
	 * 发送消息 (用户自己 / 右边)
	 * @param text 消息内容
	 * @param onDone LLM 回复流程结束后回调 (成功/失败都会触发), 可用于解除触摸锁定等
	 */
	const sendMessage = async (text: string, onDone?: () => void): Promise<ChatMessage> => {
		const MSG = pushRight(text)
		// 记录用户消息 (保证下次读 DB 历史时已包含本条)
		await contextInsert({
			type: "talk",
			role: "user",
			content: text,
			tokenCount: estimateTokens(text),
		})
		// 用 DB 历史构建 LLM 上下文 (含跨会话历史, 而非仅当前内存)
		const CONTEXT = await buildTalkMessages()
		requestLLM(CONTEXT, onDone)
		return MSG
	}

	/**
	 * 发送触摸动作的请求
	 * @param prompt 触摸提示词
	 * @param onDone LLM 回复流程结束后回调 (成功/失败都会触发), 用于解除触摸锁定
	 */
	const sendTouch = async (prompt: string, onDone?: () => void): Promise<void> => {
		await contextInsert({
			type: "touch",
			role: "user",
			content: prompt,
			tokenCount: estimateTokens(prompt),
		})
		const CONTEXT = await buildTalkMessages()
		requestLLM(CONTEXT, onDone)
	}

	/**
	 * 设置人设后触发首轮互动:
	 * - 有开场白: 直接作为 AI 首条消息 (不消耗 LLM)
	 * - 无开场白: 发起一次 LLM 请求生成问候
	 */
	const startPersona = async (persona: Persona): Promise<void> => {
		const OPENING = persona.firstMes.trim()
		if (OPENING) {
			pushLeft(OPENING)
			void contextInsert({
				type: "talk",
				role: "assistant",
				content: OPENING,
				tokenCount: estimateTokens(OPENING),
			})
			void speakReply(OPENING)
			return
		}
		const CONTEXT = await buildTalkMessages()
		requestLLM(CONTEXT)
	}

	// 只供聊天界面使用的中间信息 (含 center)
	const chatItems = computed(() => HISTORY.value)

	// 清除对话 (保留 id 递增, 避免冲突)
	const clear = () => {
		HISTORY.value = []
	}

	/**
	 * 从 context 表恢复最近的 talk 历史到界面 (只回显最近 N 条, 幂等).
	 */
	const loadHistory = async (limit = HISTORY_RELOAD_LIMIT): Promise<void> => {
		if (historyLoaded) return
		historyLoaded = true
		const RECORDS = await contextList(limit, 0)
		const TALK = RECORDS
			.filter(record => (record.type === "talk" || record.type === "touch") && record.role && record.content.trim())
			.reverse()
		HISTORY.value = TALK.map(record => ({
			id: nextId++,
			side: record.type === "touch" ? "center" as ChatSide : record.role === "assistant" ? "left" as ChatSide : "right" as ChatSide,
			text: record.content,
			createdAt: record.createdAt * 1000,
		}))
	}

	return {
		// 状态
		history: HISTORY,
		// 对方是否正在输入/加载
		isTyping,
		// 聊天界面消息
		chatItems,
		// 方法
		sendMessage,
		sendTouch,
		startPersona,
		loadHistory,
		setTyping,
		pushLeft,
		pushRight,
		pushCenter,
		clear,
	}
})
