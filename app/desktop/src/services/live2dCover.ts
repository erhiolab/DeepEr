/**
 * Live2D 模型封面获取
 *
 * 与模型选择页一致的两条路径:
 * - 自定义 / 本地配置封面: asset 协议读模型目录图片
 * - 官方模型无本地封面: 用官方列表的远程 coverUrl (带 sessionStorage 缓存, 全应用共享)
 */
import {invoke} from "@tauri-apps/api/core"
import {assetUrlSafe} from "./asset"

let officialCoversCache: Record<string, string> | null = null
let loading: Promise<void> | null = null

/**
 * 本地模型封面 URL (无配置封面时返回 null)
 */
export const localModelCover = (modelName: string, image: string): string | null => image ? assetUrlSafe(`live2d/${modelName}/${image}`) : null

/**
 * 官方模型封面映射 (id → coverUrl), 带缓存, 并发安全
 */
export const getOfficialCovers = async (): Promise<Record<string, string>> => {
	if (officialCoversCache) return officialCoversCache
	if (loading) {
		await loading
		return officialCoversCache ?? {}
	}
	loading = (async () => {
		try {
			let LIST: {id: string, coverUrl?: string}[] | null = null
			const CACHED = sessionStorage.getItem("officialModels")
			if (CACHED) {
				try {
					LIST = JSON.parse(CACHED) as {id: string, coverUrl?: string}[]
				} catch {
					LIST = null
				}
			}
			if (!LIST) {
				LIST = await invoke<{id: string, coverUrl?: string}[]>("fetch_live2d_list")
				sessionStorage.setItem("officialModels", JSON.stringify(LIST))
			}
			const MAP: Record<string, string> = {}
			for (const item of LIST ?? []) {
				if (item.id && item.coverUrl) MAP[item.id] = item.coverUrl
			}
			officialCoversCache = MAP
		} catch {
			officialCoversCache = {}
		}
	})()
	await loading
	return officialCoversCache ?? {}
}
