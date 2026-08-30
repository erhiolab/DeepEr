/**
 * AI 对话状态 (统一承载聊天界面 / 桌宠气泡 / 触摸请求的数据源)
 *
 * 架构约定:
 * - context 表是唯一事实源: 人设 (type=person) / 对话 (talk) / 触摸 (touch) 都在库里,
 *   上下文构建 / 命中率计算 / 留痕全部在后端 agent_run 完成, 前端只传用户消息.
 * - 一次请求 = 前端传消息 → Rust Agent 循环 (上下文 + 工具协议 + LLM 多轮 + 工具执行 + 留痕)
 *   → 返回最终回答 → TTS 朗读.
 * - 消息队列: AI 回复期间用户可继续发多条消息 (立即显示, 不打断当前回复),
 *   当前回复结束后把排队消息一次性批量发给 AI (sendMessage / sendTouch / 人设问候共用同一队列).
 * - TTS 统一走 useTTSStore().speak (内部负责 md 清洗 / AI 调参 / 记录 tts 上下文).
 */
import {computed, reactive, ref} from "vue"
import {defineStore} from "pinia"
import {assetUrl} from "../asset"
import {contextInsert, contextList, estimateTokens} from "../context"
import {logger} from "../logger"
import {maybeNotifyAiReply} from "../chatNotify"
import useLanguages from "../i18n/useLanguages"
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

// 排队中的一条用户消息 (AI 回复期间用户发来的消息, 下次一次性批量发送)
interface PendingMessage {
	content: string
	kind: "talk" | "touch" | "schedule"
	onDone?: () => void
}

// 从工具调用留痕 (type=tool, role=assistant) 中解析调用名列表
const parseToolCallNames = (text: string): string[] => {
	const NAMES: string[] = []
	const RE = /<tool_call\b[^>]*name\s*=\s*"([^"]+)"/g
	for (const MATCH of text.matchAll(RE)) {
		const NAME = MATCH[1].trim()
		if (NAME) NAMES.push(NAME)
	}
	return NAMES
}

// 去掉 <tool_call ...> / <tool_result ...> 标签, 还原 AI 的中间思考文本
const stripToolTags = (text: string): string => {
	return text
		.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/g, "")
		.replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
}

// 从工具结果留痕 (type=tool, role=user) 中解析 调用名 → 是否成功
const parseToolResultStatus = (text: string): Record<string, boolean> => {
	const STATUS: Record<string, boolean> = {}
	const RE = /<tool_result name="([^"]+)" ok="(true|false)">/g
	for (const MATCH of text.matchAll(RE)) {
		STATUS[MATCH[1].trim()] = MATCH[2] === "true"
	}
	return STATUS
}

// 时间分隔阈值: 30 分钟
const TIME_GAP_MS = 30 * 60 * 1000

const pad2 = (n: number): string => String(n).padStart(2, "0")

/**
 * 时间分隔文案: 今天 → 时分; 更早 → 年月日 时分
 */
const formatTimeDivider = (timestamp: number): string => {
	const DATE = new Date(timestamp)
	const NOW = new Date()
	const TIME = `${pad2(DATE.getHours())}:${pad2(DATE.getMinutes())}`
	const SAME_DAY = DATE.getFullYear() === NOW.getFullYear() && DATE.getMonth() === NOW.getMonth() && DATE.getDate() === NOW.getDate()
	if (SAME_DAY) return TIME
	return `${DATE.getFullYear()}-${pad2(DATE.getMonth() + 1)}-${pad2(DATE.getDate())} ${TIME}`
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
		// 与上一条普通消息间隔超过 30 分钟 → 插入时间分隔
		if ((side === "left" || side === "right") && HISTORY.value.length > 0) {
			const PREV = HISTORY.value[HISTORY.value.length - 1]
			if ((PREV.side === "left" || PREV.side === "right") && MSG.createdAt - PREV.createdAt >= TIME_GAP_MS) {
				const DIVIDER = reactive<ChatMessage>({id: nextId++, side: "center", text: formatTimeDivider(MSG.createdAt), createdAt: MSG.createdAt}) as ChatMessage
				HISTORY.value = [...HISTORY.value, DIVIDER]
			}
		}
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

	/**
	 * 在指定消息之前插入中间信息 (用于工具执行过程提示: 应显示在 AI 回复气泡上方)
	 */
	const pushCenterBefore = (anchorId: number, text: string): ChatMessage => {
		const MSG = reactive<ChatMessage>({id: nextId++, side: "center", text, createdAt: Date.now()}) as ChatMessage
		const INDEX = HISTORY.value.findIndex(item => item.id === anchorId)
		if (INDEX === -1) {
			HISTORY.value = [...HISTORY.value, MSG]
		} else {
			const NEXT = [...HISTORY.value]
			NEXT.splice(INDEX, 0, MSG)
			HISTORY.value = NEXT
		}
		return MSG
	}

	/**
	 * 在指定消息之前插入左侧 (AI) 消息 (用于多轮循环中的中间思考文本)
	 */
	const pushLeftBefore = (anchorId: number, text: string): ChatMessage => {
		const MSG = reactive<ChatMessage>({id: nextId++, side: "left", text, createdAt: Date.now()}) as ChatMessage
		const INDEX = HISTORY.value.findIndex(item => item.id === anchorId)
		if (INDEX === -1) {
			HISTORY.value = [...HISTORY.value, MSG]
		} else {
			const NEXT = [...HISTORY.value]
			NEXT.splice(INDEX, 0, MSG)
			HISTORY.value = NEXT
		}
		return MSG
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
	 * 触发一次 AI 回复 (上下文构建 + Agent 循环都在后端 agent_run)
	 *
	 * @param messages 本批用户消息 (空数组时只构建上下文, 用于人设首轮问候)
	 * @param onDone   回复流程结束后回调 (成功/失败都会触发)
	 */
	const requestLLM = (messages: {content: string, kind: "talk" | "touch" | "schedule"}[], onDone?: () => void) => {
		const MSG = push("left", "")
		MSG.isStreaming = true
		setTyping(true)
		void (async () => {
			try {
				// 动态导入避免循环依赖
				const {runAgent} = await import("../agent/run")
				const RESULT = await runAgent({messages}, (name, ok, output) => {
					// 工具执行过程可见: 插到当前回复气泡上方, 避免被挤到回答后面
					const CHAT = useLanguages().components.main.chat
					const REASON = ok ? "" : `: ${(output ?? CHAT.unknownReason).slice(0, 80)}`
					const RESULT_LABEL = ok
						? CHAT.toolResultSuccess
						: `${CHAT.toolResultFailed}${REASON}`
					pushCenterBefore(MSG.id, CHAT.toolCall(name, RESULT_LABEL))
				}, (text) => {
					// 中间思考文本: 以独立 AI 气泡显示在最终回答气泡上方
					if (text.trim()) pushLeftBefore(MSG.id, text.trim())
				})
			MSG.isStreaming = false
			setTyping(false)
			if (RESULT.ok && RESULT.text) {
				MSG.text = RESULT.text
				// 不在聊天页时提示音提醒 (带防抖)
				maybeNotifyAiReply()
				// 回复完成后朗读全文
				void speakReply(RESULT.text)
			} else {
				MSG.text = RESULT.error || useLanguages().components.main.chat.generateFailed
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

	// 排队消息 (AI 忙时先入队, 回复结束后一次性批量发送)
	let pendingQueue: PendingMessage[] = []
	// 是否有 AI 请求正在执行 (同一时间只跑一个, 不打断)
	let aiBusy = false

	/**
	 * 取走队列里全部消息, 批量发起一次 AI 请求 (队列空或 AI 忙时跳过)
	 */
	const drainQueue = () => {
		if (aiBusy || pendingQueue.length === 0) return
		aiBusy = true
		const BATCH = pendingQueue.splice(0)
		requestLLM(
			BATCH.map(item => ({content: item.content, kind: item.kind})),
			() => {
				aiBusy = false
				// 整批回复结束后逐个回调 (解除触摸锁定等)
				for (const ITEM of BATCH) ITEM.onDone?.()
				drainQueue()
			},
		)
	}

	/**
	 * 发送消息 (用户自己 / 右边)
	 * @param text 消息内容
	 * @param onDone 本消息所在批次回复结束后回调 (成功/失败都会触发), 可用于解除触摸锁定等
	 */
	const sendMessage = async (text: string, onDone?: () => void): Promise<ChatMessage> => {
		const MSG = pushRight(text)
		// 立即显示在聊天里, 同时入队; AI 空闲时马上批量发起, 忙时排队等下一批
		pendingQueue.push({content: text, kind: "talk", onDone})
		drainQueue()
		return MSG
	}

	/**
	 * 发送触摸动作的请求
	 * @param prompt 触摸提示词
	 * @param onDone LLM 回复流程结束后回调 (成功/失败都会触发), 用于解除触摸锁定
	 */
	const sendTouch = async (prompt: string, onDone?: () => void): Promise<void> => {
		pendingQueue.push({content: prompt, kind: "touch", onDone})
		drainQueue()
	}

	/**
	 * 定时任务到点触发: 作为中间状态 (不显示在用户气泡), 以独立 type=schedule 发给 AI
	 *
	 * @param title   任务名称
	 * @param content 任务内容 (到点发给 AI)
	 */
	const sendScheduled = (title: string, content: string, onDone?: () => void): void => {
		const TEXT = useLanguages().components.main.chat.scheduleTrigger(title, content)
		pushCenter(TEXT)
		pendingQueue.push({content: TEXT, kind: "schedule", onDone})
		drainQueue()
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
		// 无开场白: 入队一个空消息, 由后端基于人设上下文生成问候 (不写入 contexts)
		pendingQueue.push({content: "", kind: "talk"})
		drainQueue()
	}

	// 只供聊天界面使用的中间信息 (含 center)
	const chatItems = computed(() => HISTORY.value)

	// 清除对话 (保留 id 递增, 避免冲突)
	const clear = () => {
		// 丢弃尚未发送的排队消息 (正在执行中的批次不受影响)
		pendingQueue.length = 0
		HISTORY.value = []
	}

	/**
	 * 从 context 表恢复最近历史到界面 (只回显最近 N 条, 幂等).
	 *
	 * 回显内容:
	 * - type=talk: 左右气泡 (user 右 / assistant 左)
	 * - type=touch / schedule: 中间信息 (触摸动作 / 定时任务触发, 状态类不显示在用户气泡)
	 * - type=tool: 重建'🔧 调用工具 ^'中间提示 (调用名 + 成功/失败, 按记录顺序)
	 */
	const loadHistory = async (limit = HISTORY_RELOAD_LIMIT): Promise<void> => {
		if (historyLoaded) return
		historyLoaded = true
		const RECORDS = await contextList(limit, 0)
		// contextList 按 id 倒序 (最新在前), 反转成时间正序后按 id 自然有序
		const ORDERED = [...RECORDS].reverse()
		const ITEMS: {side: ChatSide, text: string, createdAt: number}[] = []
		let pendingCalls: {name: string, createdAt: number}[] = []

		for (const record of ORDERED) {
			if (record.type === "talk" || record.type === "touch" || record.type === "schedule") {
				if (!record.role || !record.content.trim()) continue
				ITEMS.push({
					side: (record.type === "touch" || record.type === "schedule") ? "center" as ChatSide : record.role === "assistant" ? "left" as ChatSide : "right" as ChatSide,
					text: record.content,
					createdAt: record.createdAt * 1000,
				})
			} else if (record.type === "tool") {
				if (record.role === "assistant") {
					// 中间思考文本还原成左侧气泡 (去掉 <tool_call>/<tool_result> 标签)
					const THOUGHT = stripToolTags(record.content)
					if (THOUGHT) {
						ITEMS.push({
							side: "left" as ChatSide,
							text: THOUGHT,
							createdAt: record.createdAt * 1000,
						})
					}
					// 本轮调用列表 (结果行紧随其后)
					pendingCalls = parseToolCallNames(record.content).map(name => ({
						name,
						createdAt: record.createdAt * 1000,
					}))
				} else if (record.role === "user" && pendingCalls.length) {
					const STATUS = parseToolResultStatus(record.content)
					const CHAT = useLanguages().components.main.chat
					for (const call of pendingCalls) {
						const OK = STATUS[call.name]
						const RESULT_LABEL = OK === undefined
							? CHAT.toolResultRunning
							: OK
								? CHAT.toolResultSuccess
								: CHAT.toolResultFailed
						ITEMS.push({
							side: "center" as ChatSide,
							text: CHAT.toolCall(call.name, RESULT_LABEL),
							createdAt: call.createdAt,
						})
					}
					pendingCalls = []
				}
			}
		}
		// 兜底: 调用行没有对应结果行时也展示 (状态未知)
		for (const call of pendingCalls) {
			const CHAT = useLanguages().components.main.chat
			ITEMS.push({
				side: "center" as ChatSide,
				text: CHAT.toolCall(call.name, CHAT.toolResultRunning),
				createdAt: call.createdAt,
			})
		}

		// 相邻消息间隔超过 30 分钟插入
		const WITH_DIVIDERS: {side: ChatSide, text: string, createdAt: number}[] = []
		for (const item of ITEMS) {
			const PREV = WITH_DIVIDERS[WITH_DIVIDERS.length - 1]
			if (PREV && item.createdAt - PREV.createdAt >= TIME_GAP_MS) {
				WITH_DIVIDERS.push({side: "center" as ChatSide, text: formatTimeDivider(item.createdAt), createdAt: item.createdAt})
			}
			WITH_DIVIDERS.push(item)
		}

		HISTORY.value = WITH_DIVIDERS.map(item => ({
			id: nextId++,
			side: item.side,
			text: item.text,
			createdAt: item.createdAt,
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
		sendScheduled,
		startPersona,
		loadHistory,
		setTyping,
		pushLeft,
		pushRight,
		pushCenter,
		clear,
	}
})
