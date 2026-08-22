// 触摸区域(自定义可触摸区域) store
// 从桌面端 services/store/touch.ts 移植, 适配移动端:
// - 持久化改用 localStorage (按模型 id), 复用 writeModelConfig/readModelConfig
// - 触发回调: 派发 window 事件 touch-triggered + 日志, 供上层(AI/动作)消费
//
// 触摸区域类型:
//   tap   = 点击   (位移 <= TAP_MAX_DISTANCE)
//   swipe = 滑动   (累计位移 >= SWIPE_MIN_DISTANCE)
//   frenzy = 连点  (窗口期内 >= FRENZY_MIN_CLICKS 次点击)

export type TouchType = "tap" | "swipe" | "frenzy"

export interface TouchArea {
	id: string
	name: string
	type: TouchType
	/** 归一化坐标(0~1, 相对模型渲染图像, 保持原始宽高比) */
	x: number
	y: number
	w: number
	h: number
	image: string
	prompt: string
}

export interface ModelRenderConfig {
	scale: number
	posX: number
	posY: number
}

export interface ModelTouchConfig {
	version: number
	render: ModelRenderConfig
	name: string
	image: string
	touches: TouchArea[]
}

// 点击阈值: 小于该位移视为点击 (逻辑像素)
export const TAP_MAX_DISTANCE = 12
// 滑动阈值: 累计移动超过该距离视为滑动
export const SWIPE_MIN_DISTANCE = 60
// 连点阈值: 窗口期内最少点击次数
export const FRENZY_MIN_CLICKS = 3
// 连点窗口期 (毫秒)
export const FRENZY_WINDOW_MS = 1200
// 触发后自动解锁兜底 (毫秒)
export const LOCK_AUTO_UNLOCK_MS = 2 * 60 * 1000

const defaultConfig = (): ModelTouchConfig => ({
	version: 1,
	render: {scale: 1.0, posX: 0.0, posY: 0.0},
	name: "",
	image: "",
	touches: [],
})

const uid = () => `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** 读取模型触摸配置(localStorage), 缺失回落默认 */
export const loadTouchConfig = (modelId: string): ModelTouchConfig => {
	try {
		const raw = localStorage.getItem(`l2d_touch_${modelId}`)
		if (!raw) return defaultConfig()
		const data = JSON.parse(raw)
		return {
			...defaultConfig(),
			...data,
			render: {...defaultConfig().render, ...data?.render},
			touches: Array.isArray(data?.touches) ? data.touches : [],
		}
	} catch {
		return defaultConfig()
	}
}

/** 持久化模型触摸配置 */
export const saveTouchConfig = (modelId: string, cfg: ModelTouchConfig): void => {
	try {
		localStorage.setItem(`l2d_touch_${modelId}`, JSON.stringify(cfg))
	} catch { /* ignore */ }
}

/** 给区域分配唯一 id */
export const newTouchId = (): string => uid()

export {defaultConfig}