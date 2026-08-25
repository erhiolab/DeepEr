import {computed, nextTick, reactive, ref} from "vue"
import {defineStore} from "pinia"
import {assetUrl} from "../asset"
import {createStreamingMarkdownSplitter, isFencedCodeBlock} from "../text/markdownSplitter"
import {logger} from "../logger"

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
 * 延迟辅助
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * AI 对话状态
 * 统一承载聊天界面 (Talk) 与桌宠气泡 (PetView) 的数据源
 */
export const useConversationStore = defineStore("conversation", () => {
	// 完整对话历史
	const HISTORY = ref<ChatMessage[]>([])

	// 消息 id 自增
	let nextId = 1

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

	// 合成一段文本的语音, 返回可播放 URL (null = 未合成/失败)
	const synthSegmentTTS = async (seg: string): Promise<string | null> => {
		try {
			// 动态导入避免循环依赖
			const {useTTSStore} = await import("./tts")
			const TTS = useTTSStore()
			const RESULT = await TTS.speak(seg)
			if (!RESULT.ok || !RESULT.audioAssetPath) {
				await logger.warn(`[conversation] 段 TTS 未合成: ${RESULT.error ?? "无音频"}`)
				return null
			}
			return assetUrl(RESULT.audioAssetPath)
		} catch (error) {
			await logger.error("[conversation] 音频合成失败", error)
			return null
		}
	}

	// 播放一段已合成的音频, 播放结束(或失败)才 resolve
	const playSegmentTTS = async (url: string): Promise<void> => {
		await new Promise<void>((resolve) => {
			const AUDIO = new Audio(url)
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
	}

	// 触发一次 AI 回复
	// - 按 Markdown 感知把文本切成若干段
	// - 普通文本段: 合成语音并播放, 播放完才发送该气泡, 播放完才进入下一条
	// - 代码块段: 不朗读, 立即发送气泡
	const requestLLM = (messages: LLMMsg[], onDone?: () => void) => {
		const MSG = push("left", "")
		MSG.isStreaming = true
		// 待发送队列与增量分割器 (跨增量保持 md 结构完整)
		const QUEUE: string[] = []
		const SPLITTER = createStreamingMarkdownSplitter()
		let sending = false
		let streamDone = false
		let fullText: string | null = null
		const finalize = () => {
			if (!MSG.isStreaming) return
			// 兜底: 补齐完整文本 (事件缺失导致 MSG.text 不完整时)
			if (fullText !== null && MSG.text !== fullText) {
				MSG.text = fullText
			}
			MSG.isStreaming = false
			setTyping(false)
			onDone?.()
		}
		// 音频驱动的常驻发送循环
		// - 普通文本段: 合成语音 + 播放, 播完 `MSG.text += seg` 再取下一条
		// - 代码块段: 立即出气泡, 不阻塞
		// - 队列空但流未结束时短暂轮询等待新段
		const kick = () => {
			if (sending) return
			sending = true
			void (async () => {
				while (!streamDone || QUEUE.length) {
					if (QUEUE.length) {
						const SEG = QUEUE.shift()!
						if (isFencedCodeBlock(SEG)) {
							// md 代码块: 不朗读, 直接发送气泡
							MSG.text += SEG
						} else {
							// 普通文本段: 先出气泡 (立即), 渲染完成后再后台合成语音并播放;
							// 播放完才取下一条
							MSG.text += SEG
							await nextTick()
							const URL = await synthSegmentTTS(SEG)
							if (URL) await playSegmentTTS(URL)
						}
					} else {
						await sleep(15)
					}
				}
				sending = false
				finalize()
			})()
		}
		setTyping(true)
		void (async () => {
			try {
				// 动态导入避免循环依赖
				const {useLLMStore} = await import("./llm")
				const RESULT = await useLLMStore().generateStream({messages}, (delta) => {
					const {completed} = SPLITTER.consume(delta)
					if (completed.length) {
						QUEUE.push(...completed)
						// 只要队列有数据就立即启动发送 (不等流结束)
						kick()
					}
				})
				// 流式结束: 记录完整文本, 把 splitter 里剩余的尾巴作为最后一段入队
				streamDone = true
				fullText = RESULT.ok && RESULT.text ? RESULT.text : null
				const REST = SPLITTER.getRest().trim()
				if (REST) {
					QUEUE.push(REST)
					SPLITTER.reset()
				}
				kick()
			} catch (err) {
				await logger.error("conversation LLM 请求异常", err)
				// 异常: 丢弃剩余队列, 结束发送循环并收尾
				streamDone = true
				QUEUE.length = 0
				kick()
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
