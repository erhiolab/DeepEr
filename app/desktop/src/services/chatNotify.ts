/**
 * 聊天提示: 不在聊天页面时, AI 回复到达播放提示音 (带防抖)
 */
import reminderAudio from "../assets/audio/reminder.m4a"

/**
 * 是否正在查看聊天页面 (由 Main.vue 随导航切换更新)
 */
let chatPageActive = false

/**
 * 提示音最小间隔 (防轰炸)
 */
const MIN_INTERVAL_MS = 5000

let lastPlayedAt = 0

/**
 * 更新聊天页可见状态
 */
export const setChatPageActive = (active: boolean): void => {
	chatPageActive = active
}

/**
 * AI 回复到达时调用: 正在看聊天页且窗口可见则不提示, 否则播放提示音 (限频)
 */
export const maybeNotifyAiReply = (): void => {
	// 正在看聊天页且页面可见 → 不打扰
	if (chatPageActive && !document.hidden) return
	const NOW = Date.now()
	if (NOW - lastPlayedAt < MIN_INTERVAL_MS) return
	lastPlayedAt = NOW
	try {
		void new Audio(reminderAudio).play()
	} catch {
		// 播放失败 (自动播放策略等) 静默忽略
	}
}
