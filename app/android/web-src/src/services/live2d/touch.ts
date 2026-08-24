









export type TouchType = "tap" | "swipe" | "frenzy"

export interface TouchArea {
	id: string
	name: string
	type: TouchType
	
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


export const TAP_MAX_DISTANCE = 12

export const SWIPE_MIN_DISTANCE = 60

export const FRENZY_MIN_CLICKS = 3

export const FRENZY_WINDOW_MS = 1200

export const LOCK_AUTO_UNLOCK_MS = 2 * 60 * 1000

const defaultConfig = (): ModelTouchConfig => ({
	version: 1,
	render: {scale: 1.0, posX: 0.0, posY: 0.0},
	name: "",
	image: "",
	touches: [],
})

const uid = () => `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`


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


export const saveTouchConfig = (modelId: string, cfg: ModelTouchConfig): void => {
	try {
		localStorage.setItem(`l2d_touch_${modelId}`, JSON.stringify(cfg))
	} catch {  }
}


export const newTouchId = (): string => uid()

export {defaultConfig}