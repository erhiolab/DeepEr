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
}

// 模型不再内置: 联网下载后存入 OPFS, 由 sw.js 以相对路径 live2d/** 提供.
// 使用相对路径是为了落在 Service Worker 的 scope (页面所在目录) 内.
export const live2dUrl = (relativePath: string): string =>
	`live2d/${relativePath.replace(/^\/+/, "")}`

export const L2D_CONFIG_KEYS = ["l2d_scale", "l2d_offset_x", "l2d_offset_y", "l2d_expression"] as const
export type L2DConfigKey = (typeof L2D_CONFIG_KEYS)[number]
export const l2dModelKey = (base: L2DConfigKey, modelId: string): string => `${base}_${modelId}`

export const parseNumber = (value: unknown): number | null => {
	if (typeof value === "number") return value
	if (typeof value === "string" && value !== "") {
		const n = parseFloat(value)
		return Number.isNaN(n) ? null : n
	}
	return null
}

export const readModelConfig = async <T>(
	modelId: string,
	base: L2DConfigKey,
	parse: (value: unknown) => T | null,
	fallback: T
): Promise<T> => {
	for (const key of [l2dModelKey(base, modelId), base]) {
		try {
			const raw = localStorage.getItem(key)
			if (raw != null) {
				const parsed = parse(raw)
				if (parsed != null) return parsed
			}
		} catch { /* ignore */ }
	}
	return fallback
}

export const writeModelConfig = (modelId: string, base: L2DConfigKey, value: unknown): void => {
	try {
		const key = l2dModelKey(base, modelId)
		if (value == null) localStorage.removeItem(key)
		else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value))
	} catch { /* ignore */ }
}
