// 网关 API 客户端: 与桌面端 app/desktop/src-tauri/src/api.rs 保持一致
// 基础地址 https://api.elake.top/deeper, 后端 CORS 允许任意 origin, WebView 可直接调用

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

/** GET /live2d/list 官方模型列表 */
export const fetchLive2dList = (): Promise<{list: Live2dSummary[]}> =>
	getJson<{list: Live2dSummary[]}>("/live2d/list")

/** GET /resource/download_url 获取签名下载链接 (有效期 300 秒) */
export const fetchDownloadUrl = (type: string, name: string): Promise<{url: string}> =>
	getJson<{url: string}>("/resource/download_url", {type, name})

/** GET /live2d/cover 模型封面图地址 */
export const coverUrl = (id: string): string =>
	`${API_BASE_URL}/live2d/cover?id=${encodeURIComponent(id)}`
