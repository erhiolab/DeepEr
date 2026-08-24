






import type {TouchArea} from "./touch"


const contain = (sw: number, sh: number, w: number, h: number): {dw: number; dh: number; ox: number; oy: number} | null => {
	if (!sw || !sh || !w || !h) return null
	const S = Math.min(w / sw, h / sh)
	return {dw: sw * S, dh: sh * S, ox: (w - sw * S) / 2, oy: (h - sh * S) / 2}
}


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


export const SWIPE_DIST = 16

export const SWIPE_AUTO_MS = 700


export class TouchDetector {
	private touches: TouchArea[] = []
	private canvas: HTMLElement | null = null
	private modelW = 0
	private modelH = 0

	private onTrigger: ((area: TouchArea, type: "tap" | "swipe") => void) | null = null
	
	private cooldownMs = 2000
	private lastTriggerAt = new Map<string, number>()
	
	private pending: {area: TouchArea; cum: number; startTs: number} | null = null
	
	private px = 0
	private py = 0

	constructor(onTrigger?: (area: TouchArea, type: "tap" | "swipe") => void) {
		this.onTrigger = onTrigger ?? null
	}

	setCooldown(ms: number) {
		if (ms > 0) this.cooldownMs = ms
	}

	
	configure(touches: TouchArea[], canvas: HTMLElement | null, modelW = 0, modelH = 0) {
		this.touches = touches
		this.canvas = canvas
		this.modelW = modelW
		this.modelH = modelH
	}

	
	private fire(area: TouchArea, type: "tap" | "swipe") {
		this.lastTriggerAt.set(area.id, Date.now())
		this.onTrigger?.(area, type)
	}

	
	onPointerDown(e: PointerEvent) {
		this.pending = null
		this.px = e.clientX
		this.py = e.clientY
		const P = toModelPoint(e.clientX, e.clientY, this.canvas, this.modelW, this.modelH)
		if (!P) return
		for (let i = this.touches.length - 1; i >= 0; i--) {
			const T = this.touches[i]
			if (hitTouchArea(P.x, P.y, T.x, T.y, T.w, T.h)) {
				
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