import {computed, ref} from "vue"
import {defineStore} from "pinia"

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
}

/**
 * AI 对话状态
 * 统一承载聊天界面 (Talk) 与桌宠气泡 (PetView) 的数据源
 */
export const useConversationStore = defineStore("conversation", () => {
	// 完整对话历史
	const HISTORY = ref<ChatMessage[]>([])

	// 消息 id 自增
	let nextId = 1

	// 生成一条消息并写入历史
	const push = (side: ChatSide, text: string): ChatMessage => {
		const MSG: ChatMessage = {id: nextId++, side, text, createdAt: Date.now()}
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
	 * 收到回复时自动结束"正在输入"状态
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
	 * 插入中间信息 (时间分隔 / 系统状态), 只进历史, 不会出现在桌宠气泡
	 */
	const pushCenter = (text: string): ChatMessage => push("center", text)

	// 当前对话历史映射为 LLM 消息 (只取最近的若干条)
	type LLMMsg = {role: "user" | "assistant" | "system", content: string}
	const toLLMMessages = (): LLMMsg[] => HISTORY.value.slice(-20).map((m): LLMMsg => {
		const ROLE: LLMMsg["role"] = m.side === "right" ? "user" : m.side === "left" ? "assistant" : "system"
		return {role: ROLE, content: m.text}
	})

	// 触发一次 LLM 生成, 成功时插入左边回复, 完成后回调并复位键入状态
	const requestLLM = (messages: LLMMsg[], onDone?: () => void) => {
		setTyping(true)
		void (async () => {
			try {
				// 动态导入避免循环依赖
				const {useLLMStore} = await import("./llm")
				const RESULT = await useLLMStore().generate({messages})
				if (RESULT.ok && RESULT.text) {
					pushLeft(RESULT.text)
				}
			} catch (err) {
				await import("../logger").then(({logger}) => logger.error("conversation LLM 请求异常", err))
			} finally {
				setTyping(false)
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
		requestLLM(toLLMMessages(), onDone)
		return MSG
	}

	/**
	 * 发送触摸动作的请求
	 * @param prompt 触摸提示词
	 * @param onDone LLM 回复流程结束后回调 (成功/失败都会触发), 用于解除触摸锁定
	 */
	const sendTouch = async (prompt: string, onDone?: () => void): Promise<void> => {
		const MESSAGES = [...toLLMMessages(), {role: "user" as const, content: prompt}]
		requestLLM(MESSAGES, onDone)
	}

	// 只供聊天界面使用的中间信息 (含 center)
	const chatItems = computed(() => HISTORY.value)

	// 清除对话 (保留 id 递增, 避免冲突)
	const clear = () => {
		HISTORY.value = []
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
		setTyping,
		pushLeft,
		pushRight,
		pushCenter,
		clear,
	}
})
