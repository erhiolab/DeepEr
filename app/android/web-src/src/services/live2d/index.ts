import {
	getAllMotionsInfo,
	load,
	playExpression,
	playMotion,
	setAngleXY,
	stop,
	stopExpression,
} from "live2d-easy-control"
import {live2dUrl} from "./config"

declare global {
	interface Window {
		__noriRenderScale?: number
	}
}

export interface Live2DModelSpec {
	directory: string
	fileBase: string
}

export interface MotionGroup {
	group: string
	names: string[]
}

export const MOTION_PRIORITY = {
	none: 0,
	idle: 1,
	normal: 2,
	force: 3,
} as const

export interface Live2DMountOptions {
	canvasWidth?: string
	canvasHeight?: string
	
	host?: HTMLElement | null
}



const buildLoadConfig = (model: Live2DModelSpec, options: Live2DMountOptions = {}): Record<string, unknown> => ({
	modelDir: model.fileBase,
	resourcesPath: `${live2dUrl(model.directory)}/`,
	canvasSize: "auto",
	canvasWidth: options.canvasWidth ?? "100%",
	canvasHeight: options.canvasHeight ?? "100%",
})

export const createLive2D = () => {
	let canvasEl: HTMLCanvasElement | null = null
	
	
	let didLoad = false

	const canvas = (): HTMLCanvasElement | null => canvasEl

	
	const srcSize = (): {w: number; h: number} | null => {
		if (!canvasEl) return null
		const w = canvasEl.width
		const h = canvasEl.height
		if (!w || !h) return null
		return {w, h}
	}

	const mount = async (model: Live2DModelSpec, options?: Live2DMountOptions): Promise<void> => {
		if (canvasEl && canvasEl.isConnected) canvasEl.remove()
		canvasEl = null
		await load(buildLoadConfig(model, options))
		didLoad = true
		canvasEl = document.body.querySelector("canvas")
		if (canvasEl) {
			
			
			if (options?.host) options.host.appendChild(canvasEl)
			canvasEl.style.pointerEvents = "none"
			canvasEl.style.position = "fixed"
			canvasEl.style.left = "0"
			canvasEl.style.top = "0"
			canvasEl.style.bottom = "auto"
			canvasEl.style.right = "auto"
			canvasEl.style.width = "100%"
			canvasEl.style.height = "100%"
			canvasEl.style.transform = "none"
			
			canvasEl.style.zIndex = "1"
		}
	}

	const destroy = async (): Promise<void> => {
		if (didLoad) {
			try { await stop() } catch {  }
			didLoad = false
		}
		if (canvasEl && canvasEl.isConnected) canvasEl.remove()
		canvasEl = null
	}

	const getMotions = async (): Promise<MotionGroup[] | null> => {
		try { return await getAllMotionsInfo() } catch { return null }
	}

	
	
	
	const setRenderScale = (scale: number): void => {
		try {
			window.__noriRenderScale = scale
			if (canvasEl) {
				const w = canvasEl.style.width, h = canvasEl.style.height
				canvasEl.style.width = "99.99%"
				canvasEl.style.height = "99.99%"
				
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						canvasEl!.style.width = w
						canvasEl!.style.height = h
					})
				})
			}
		} catch {  }
	}

	const playMotionByIndex = async (group: string, no: number, priority = MOTION_PRIORITY.force): Promise<boolean> => {
		try { await playMotion(group, no, priority); return true } catch { return false }
	}

	const playMotionByName = async (name: string, priority = MOTION_PRIORITY.force): Promise<boolean> => {
		const groups = await getMotions()
		if (!groups) return false
		for (const g of groups) {
			const idx = g.names.findIndex((n) => n === name)
			if (idx >= 0) return playMotionByIndex(g.group, idx, priority)
		}
		return false
	}

	return {
		mount,
		lookAt: (x: number, y: number, duration?: number) => setAngleXY(x, y, duration),
		playExpression: (name: string) => playExpression(name),
		stopExpression: () => stopExpression(),
		destroy,
		canvas,
		srcSize,
		getMotions,
		setRenderScale,
		playMotionByIndex,
		playMotionByName,
	}
}

export type Live2DController = ReturnType<typeof createLive2D>

export {
	live2dUrl,
	L2D_CONFIG_KEYS,
	readModelConfig,
	writeModelConfig,
	parseNumber,
	l2dModelKey,
} from "./config"