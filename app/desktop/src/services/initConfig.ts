import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * 首次初始化配置快照 (对应后端 config::InitConfig)
 */
export interface InitConfig {
	appVersion: string
	installedAt: string
	initializedAt: string | null
	language: string
	selectedModel: string
}

/**
 * 获取首次初始化配置: invoke("get_init_config")
 * 读取失败 (如非 Tauri 环境) 时返回 null, 不抛出异常
 */
export async function getInitConfig(): Promise<InitConfig | null> {
	try {
		return await invoke<InitConfig>("get_init_config")
	} catch (error) {
		await logger.error("获取初始化配置失败:", error)
		return null
	}
}
