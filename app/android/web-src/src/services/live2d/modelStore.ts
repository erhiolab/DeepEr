// 模型在线下载: 交由原生 ModelBridge (window.NoriBridge) 完成下载 + 解压 + 落盘,
// 模型文件再由原生 shouldInterceptRequest 拦截 live2d/** 请求从磁盘返回.
// 前端只需调用 bridge, 不依赖浏览器 OPFS / Service Worker.

import {fetchLive2dList} from "../gateway/api"

export type ProgressFn = (phase: string, percent?: number) => void

interface InstalledMeta {
	id: string
	entryBase: string
}

interface Bridge {
	download: (id: string) => string
	listInstalled: () => string
}

/** 原生桥可能未注入 (例如在纯浏览器里调试), 这里做个安全探测 */
declare global {
	interface Window {
		NoriBridge?: Bridge
	}
}

const bridge = (): Bridge => {
	if (!window.NoriBridge) throw new Error("模型下载组件不可用 (NoriBridge 未注入)")
	return window.NoriBridge
}

const parseBridgeResult = (raw: string): {ok: boolean; entryBase?: string; message?: string} => {
	try {
		return JSON.parse(raw)
	} catch {
		return {ok: false, message: "原生返回格式错误"}
	}
}

export const fetchModelList = async (): Promise<{id: string; name: string}[]> => {
	const body = await fetchLive2dList()
	return body.list ?? []
}

export const listInstalled = async (): Promise<InstalledMeta[]> => {
	try {
		const raw = bridge().listInstalled()
		const arr = JSON.parse(raw)
		if (!Array.isArray(arr)) return []
		return arr.filter((i) => i && typeof i.id === "string" && typeof i.entryBase === "string")
	} catch {
		return []
	}
}

export const getInstalled = async (id: string): Promise<InstalledMeta | undefined> =>
	(await listInstalled()).find((i) => i.id === id)

/** 确保模型已安装到磁盘, 返回入口文件基础名; 已存在则直接返回 */
export const ensureModel = async (id: string, _name: string, _onProgress: ProgressFn): Promise<string> => {
	const cached = await getInstalled(id)
	if (cached?.entryBase) return cached.entryBase
	if (!window.NoriBridge) throw new Error("NoriBridge 未注入")
	const res = parseBridgeResult(bridge().download(id))
	if (!res.ok) throw new Error(res.message ?? "模型下载失败")
	if (!res.entryBase) throw new Error("模型下载成功但缺少入口信息")
	return res.entryBase
}

/** 原生桥暴露的模型根目录 (供调试 / 拦截使用) */
export const modelsDirOf = (): string | null => "models"