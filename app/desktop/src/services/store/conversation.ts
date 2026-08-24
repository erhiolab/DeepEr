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

	// 对方是否正在输入/加载 (统一托管, 聊天界面与桌宠共享)
	const isTyping = ref(false)
	// 输入状态自动复位的兜底超时 (防止外部忘记结束后一直卡住)
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
		setTyping,
		pushLeft,
		pushRight,
		pushCenter,
		clear,
	}
})
