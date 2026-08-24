


const API_BASE_URL = "https://api.elake.top/deeper"

export interface ApiResponse<T> {
	body: T | null
	error: boolean
	message: string
	timestamp: number
}

export interface Live2dSummary {
	id: string
	name: string
}

const getJson = async <T>(path: string, query: Record<string, string> = {}): Promise<T> => {
	const url = new URL(API_BASE_URL + path)
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
	const resp = await fetch(url.toString())
	if (!resp.ok) throw new Error(`网关请求失败: HTTP ${resp.status}`)
	const data = (await resp.json()) as ApiResponse<T>
	if (data.error) throw new Error(data.message || "网关返回错误")
	if (data.body == null) throw new Error("网关响应缺少 body")
	return data.body
}


export const fetchLive2dList = (): Promise<{list: Live2dSummary[]}> =>
	getJson<{list: Live2dSummary[]}>("/live2d/list")


export const fetchDownloadUrl = (type: string, name: string): Promise<{url: string}> =>
	getJson<{url: string}>("/resource/download_url", {type, name})


export const coverUrl = (id: string): string =>
	`${API_BASE_URL}/live2d/cover?id=${encodeURIComponent(id)}`
