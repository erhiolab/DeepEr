import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"

export type ConfigKey =
	"first_run_completed" | "initialized_at" | "language" | "main_active_nav" |
	"llm_api_base" | "llm_api_key" | "llm_model" |
	"llm_adapter" |
	"tts_adapter" |
	"live2d_model" |
	"pet_window_x" | "pet_window_y" | "pet_width" | "pet_height"

/**
 * 从 Tauri `get_config` 返回中提取存储字符串.
 */
export const extractConfigValue = (raw: unknown): string | null => {
	if (raw === null || raw === undefined) return null
	if (typeof raw === "string") return raw
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
	try {
		return JSON.stringify(raw)
	} catch {
		return null
	}
}

export const config = {
	/**
	 * 读取一个已声明 key 的配置, 统一解析为字符串
	 *
	 * @param key 配置键
	 * @returns 存储字符串; 缺失/失败返回 null
	 */
	get: async (key: ConfigKey): Promise<string | null> => {
		try {
			await logger.info(`get配置键 ${key}`)
			const RAW = await invoke<unknown>("get_config", {key})
			return extractConfigValue(RAW)
		} catch (error) {
			await logger.error(`获取配置键 ${key} 失败: ${error}`, error)
			return null
		}
	},
	/**
	 * 写入一个已声明 key 的配置.
	 */
	set: async (key: ConfigKey, value: string | number | boolean, log = true): Promise<void> => {
		try {
			await logger.info(log ? `set配置键 ${key} 为: ${value}` : `set配置键 ${key}`)
			await invoke("set_config", {key, value})
		} catch (error) {
			await logger.error(`设置配置键 ${key} 失败: ${error}`, error)
		}
	},
	/**
	 * 删除一个已声明 key 的配置.
	 */
	delete: async (key: ConfigKey): Promise<void> => {
		try {
			await logger.info(`delete配置键 ${key}`)
			await invoke("delete_config", {key})
		} catch (error) {
			await logger.error(`删除配置键 ${key} 失败: ${error}`, error)
		}
	},
	/**
	 * 读取任意字符串 key 的配置 (供适配器等使用动态 key), 统一解析为字符串.
	 *
	 * @param key 配置键 (不限 ConfigKey)
	 * @returns 存储字符串; 缺失/失败返回 null
	 */
	getRaw: async (key: string): Promise<string | null> => {
		try {
			const RAW = await invoke<unknown>("get_config", {key})
			return extractConfigValue(RAW)
		} catch (error) {
			await logger.error(`获取配置键 ${key} 失败: ${error}`, error)
			return null
		}
	},
	/**
	 * 写入任意字符串 key 的配置 (供适配器等使用动态 key).
	 */
	setRaw: async (key: string, value: string | number | boolean, log = true): Promise<void> => {
		try {
			await logger.info(log ? `set配置键 ${key} 为: ${value}` : `set配置键 ${key}`)
			await invoke("set_config", {key, value})
		} catch (error) {
			await logger.error(`设置配置键 ${key} 失败: ${error}`, error)
		}
	},
}
