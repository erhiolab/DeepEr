



import {fetchLive2dList} from "../gateway/api"

export type ProgressFn = (phase: string, percent?: number) => void

interface InstalledMeta {
	id: string
	entryBase: string
}

interface Bridge {
	download: (id: string) => void
	listInstalled: () => string
}


declare global {
	interface Window {
		NoriBridge?: Bridge
		__noriModelRes?: (json: string) => void
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


export const ensureModel = async (id: string, _name: string, _onProgress: ProgressFn): Promise<string> => {
	const cached = await getInstalled(id)
	if (cached?.entryBase) return cached.entryBase
	if (!window.NoriBridge) throw new Error("NoriBridge 未注入")
	return new Promise((resolve, reject) => {
		window.__noriModelRes = (json) => {
			delete window.__noriModelRes
			const res = parseBridgeResult(json)
			if (res.ok && res.entryBase) resolve(res.entryBase)
			else reject(new Error(res.message || "模型下载失败"))
		}
		try { bridge().download(id) } catch (e: any) { reject(e) }
	})
}


export const modelsDirOf = (): string | null => "models"