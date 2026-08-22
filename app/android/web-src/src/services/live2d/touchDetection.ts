// 触摸命中检测（移动端简化版）
// 从桌面端移植并对移动端做适配：
// - 判定简化：不区分 tap/swipe/frenzy，指针按下落在某区域即触发（带 CD 防抖）
// - 坐标基准：直接取 canvas 元素的应用后边界矩形（getBoundingClientRect），
//   已包含模型的 CSS 缩放/位移，因此框选区域与命中检测都会随模型移动缩放自动适配
// - CD：每个区域触发后冷却 cooldownMs 毫秒内不重复触发，防止每次触摸都触发 AI 消耗 token

import type {TouchArea} from "./touch"

/**
 * 等比 contain 适配: 把宽高为 (sw,sh) 的模型内容按比例放入 (w,h) 的显示矩形内,
 * 返回内容矩形的实际尺寸(dw,dh)与左上顶点偏移(ox,oy)。这是桌面端 Touch.vue 的映射基准:
 * 触摸区域的归一化坐标都相对"模型内容矩形"计算, 因此无论模型缩放/位移如何, 框始终贴合模型。
 */
const contain = (sw: number, sh: number, w: number, h: number): {dw: number; dh: number; ox: number; oy: number} | null => {
	if (!sw || !sh || !w || !h) return null
	const S = Math.min(w / sw, h / sh)
	return {dw: sw * S, dh: sh * S, ox: (w - sw * S) / 2, oy: (h - sh * S) / 2}
}

/** 基于一个元素的显示矩形 + 模型自然宽高, 计算模型内容矩形在"元素内"的轴向布局 (桌面端同款) */
export const modelLayout = (
	el: HTMLElement | null,
	modelW: number,
	modelH: number
): {x: number; y: number; w: number; h: number} | null => {
	if (!el) return null
	const R = el.getBoundingClientRect()
	if (R.width <= 0 || R.height <= 0) return null
	if (!modelW || !modelH) return {x: 0, y: 0, w: R.width, h: R.height}
	const C = contain(modelW, modelH, R.width, R.height)
	if (!C) return {x: 0, y: 0, w: R.width, h: R.height}
	return {x: C.ox, y: C.oy, w: C.dw, h: C.dh}
}

/** 把屏幕坐标(clientX/Y)映射为该元素内模型内容矩形的归一化坐标(0~1) */
export const toModelPoint = (
	clientX: number,
	clientY: number,
	el: HTMLElement | null,
	modelW: number,
	modelH: number
): {x: number; y: number} | null => {
	if (!el) return null
	const R = el.getBoundingClientRect()
	if (R.width <= 0 || R.height <= 0) return null
	if (clientX < R.left || clientX > R.right || clientY < R.top || clientY > R.bottom) return null
	let ox = 0, oy = 0, dw = R.width, dh = R.height
	if (modelW && modelH) {
		const C = contain(modelW, modelH, R.width, R.height)
		if (C) { ox = C.ox; oy = C.oy; dw = C.dw; dh = C.dh }
	}
	return {
		x: Math.max(0, Math.min(1, (clientX - R.left - ox) / dw)),
		y: Math.max(0, Math.min(1, (clientY - R.top - oy) / dh)),
	}
}

export const hitTouchArea = (x: number, y: number, px: number, py: number, pw: number, ph: number): boolean =>
	x >= px && x <= px + pw && y >= py && y <= py + ph

/** 滑动判定阈值: 手指累计位移超过该值(逻辑像素)视为"摸"(滑动), 否则为"戳"(点击) */
export const SWIPE_DIST = 16
/** 摸的自动触发延迟: 按住移动达到该时长且位移达标后, 不松手也自动触发聊天 */
export const SWIPE_AUTO_MS = 700

/**
 * 触摸检测器：配置后，将 pointer 事件交给它即可。
 * 单指有效；多指缩放/面板打开等由外部(App)调度，避免误触发。
 * - 单指点按(累计位移 < SWIPE_DIST) = 戳/点 (tap)
 * - 单指来回移动(累计位移 >= SWIPE_DIST) = 摸 (swipe), 按松开时判定
 * - 双指缩放手势由 App 层(App)处理, 不进入本检测器
 */
export class TouchDetector {
	private touches: TouchArea[] = []
	private canvas: HTMLElement | null = null
	private modelW = 0
	private modelH = 0

	private onTrigger: ((area: TouchArea, type: "tap" | "swipe") => void) | null = null
	// 每区域触发冷却(ms)
	private cooldownMs = 2000
	private lastTriggerAt = new Map<string, number>()
	// 正在触摸命中的候选项
	private pending: {area: TouchArea; cum: number; startTs: number} | null = null
	// 上一点位置(用于累计位移判定, 兼容 touch 指针不提供 movementX)
	private px = 0
	private py = 0

	constructor(onTrigger?: (area: TouchArea, type: "tap" | "swipe") => void) {
		this.onTrigger = onTrigger ?? null
	}

	setCooldown(ms: number) {
		if (ms > 0) this.cooldownMs = ms
	}

	/** 配置上下文：触摸区域 + 渲染 canvas 元素 + 模型自然宽高(用于 contain 对齐模型内容矩形) */
	configure(touches: TouchArea[], canvas: HTMLElement | null, modelW = 0, modelH = 0) {
		this.touches = touches
		this.canvas = canvas
		this.modelW = modelW
		this.modelH = modelH
	}

	/** 触发一次并记录 CD */
	private fire(area: TouchArea, type: "tap" | "swipe") {
		this.lastTriggerAt.set(area.id, Date.now())
		this.onTrigger?.(area, type)
	}

	/** 指针按下：仅记录命中的候选项, 松手后按位移判定类型 */
	onPointerDown(e: PointerEvent) {
		this.pending = null
		this.px = e.clientX
		this.py = e.clientY
		const P = toModelPoint(e.clientX, e.clientY, this.canvas, this.modelW, this.modelH)
		if (!P) return
		for (let i = this.touches.length - 1; i >= 0; i--) {
			const T = this.touches[i]
			if (hitTouchArea(P.x, P.y, T.x, T.y, T.w, T.h)) {
				// CD 内不响应
				if (Date.now() - (this.lastTriggerAt.get(T.id) || 0) < this.cooldownMs) return
				this.pending = {area: T, cum: 0, startTs: Date.now()}
				return
			}
		}
	}

	onPointerMove(e: PointerEvent) {
		if (!this.pending) return
		this.pending.cum += Math.abs(e.clientX - this.px) + Math.abs(e.clientY - this.py)
		this.px = e.clientX
		this.py = e.clientY
		// 摸: 位移达标且持续触摸足够时间后, 不松手也自动触发
		if (this.pending.cum >= SWIPE_DIST && Date.now() - this.pending.startTs >= SWIPE_AUTO_MS) {
			const t = this.pending.area
			this.pending = null
			this.fire(t, "swipe")
		}
	}

	onPointerUp(_e: PointerEvent) {
		if (!this.pending) return
		const type: "tap" | "swipe" = this.pending.cum >= SWIPE_DIST ? "swipe" : "tap"
		const t = this.pending.area
		this.pending = null
		this.fire(t, type)
	}

	destroy() {
		this.pending = null
		this.lastTriggerAt.clear()
	}
}