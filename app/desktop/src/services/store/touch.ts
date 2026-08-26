import {computed, ref} from "vue"
import {defineStore} from "pinia"
import {logger} from "../logger"
import useLanguages from "../i18n/useLanguages.ts"
import {useConversationStore} from "./conversation"
import {useLive2DStore} from "./live2d"

/**
 * 触摸区域类型
 */
export type TouchType = "tap" | "swipe" | "frenzy"

/**
 * 触摸区域配置
 */
export interface TouchArea {
	id: string
	name: string
	type: TouchType
	x: number
	y: number
	w: number
	h: number
	prompt: string
}

/**
 * 点击阈值
 * 小于该位移视为点击 (逻辑像素)
 */
export const TAP_MAX_DISTANCE = 12

/**
 * 磨蹭阈值
 * 累计移动超过该距离视为磨蹭
 */
export const SWIPE_MIN_DISTANCE = 60

/**
 * 点击狂点阈值
 * 窗口期内最少点击次数
 */
export const FRENZY_MIN_CLICKS = 5

/**
 * 点击狂点阈值
 * 窗口期时间窗口 (毫秒)
 */
export const FRENZY_WINDOW_MS = 1000

/**
 * 触摸行为 store
 * 只负责触摸触发行为 (锁定 / 触发事件), 触摸区域数据与模型配置统一由 `useLive2DStore` 持有
 */
export const useTouchStore = defineStore("touch", () => {
	// 界面文案 (随语言响应式)
	const I18N = computed(() => useLanguages().components.live2d)

	// 触摸触发锁定
	// 触发回调后锁定整个触摸, 防止同一对手势无限触发, 由外部执行 unlock() 解锁 (如 AI 返回后), 并有 2 分钟自动解锁兜底
	const locked = ref(false)

	// 移动状态锁定
	const moving = ref(false)

	// 设置移动状态: 移动/调整窗口大小期间置 true, 结束置 false
	const setMoving = (value: boolean) => {
		moving.value = value
	}

	// 锁定后的自动解锁定时器
	let lockTimer: ReturnType<typeof setTimeout> | null = null

	// 锁定后无外部解锁时自动解锁的时长 (毫秒)
	const LOCK_AUTO_UNLOCK_MS = 2 * 60 * 1000

	// 清除自动解锁定时器
	const clearLockTimer = () => {
		if (lockTimer) {
			clearTimeout(lockTimer)
			lockTimer = null
		}
	}

	/**
	 * 手动解锁触摸, 同时取消自动解锁兜底
	 */
	const unlock = () => {
		clearLockTimer()
		locked.value = false
	}

	/**
	 * 锁定触摸: 触发回调后立即锁定, 并启动自动解锁兜底
	 */
	const lock = () => {
		locked.value = true
		clearLockTimer()
		lockTimer = setTimeout(() => {
			lockTimer = null
			locked.value = false
		}, LOCK_AUTO_UNLOCK_MS)
	}

	/**
	 * 触发一个自定义触摸回调
	 * 触发后立即锁定 (防止同一手势无限触发), 需外部 `unlock` 解锁或等待 2 分钟自动解锁
	 */
	const trigger = async (touch: TouchArea) => {
		if (moving.value) {
			await logger.info(`[touch] 触发被移动状态锁定忽略: ${touch.name} (桌宠正在移动/调整大小)`)
			return
		}
		// 已锁住时不重复触发
		if (locked.value) {
			await logger.info(`[touch] 触发被锁定忽略: ${touch.name} (等待解锁或自动解锁)`)
			return
		}
		// 先锁定 (含 2 分钟自动解锁兜底), 防止触发期间被重复回调
		lock()
		// 按触摸类型取本地化描述
		const TYPED_PROMPT = touch.type === "swipe" ? I18N.value.touchedSwipe(touch.name) : touch.type === "frenzy" ? I18N.value.touchedFrenzy(touch.name) : I18N.value.touchedName(touch.name)
		// 当前模型名由 live2d store 统一持有
		const L2D = useLive2DStore()
		const PAYLOAD = {
			modelName: L2D.currentModel,
			touchName: touch.name,
			touchType: touch.type,
			touchPrompt: touch.prompt || TYPED_PROMPT,
			touchId: touch.id,
		}
		await logger.info(`[touch] 触发: ${JSON.stringify(PAYLOAD)}`)
		const CONV = useConversationStore()
		const PROMPT_TEXT = touch.prompt || TYPED_PROMPT
		CONV.pushCenter(PROMPT_TEXT)
		await CONV.sendTouch(PROMPT_TEXT, unlock)
	}

	return {
		lock,
		unlock,
		locked,
		moving,
		setMoving,
		trigger,
	}
})
