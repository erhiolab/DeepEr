import {invoke} from "@tauri-apps/api/core"
import {logger} from "../logger"

export type ConfigKey =
	"language" | "main_active_nav" |
	"llm_api_base" | "llm_api_key" | "llm_model" |
	"live2d_model" | "live2d_scale" | "live2d_pos_x" | "live2d_pos_y" |
	"pet_window_x" | "pet_window_y" | "pet_width" | "pet_height"

export const config = {
	get: async (key: ConfigKey) => {
		try {
			await logger.info(`get配置键 ${key}`)
			return invoke<string | null>("get_config", {key})
		} catch (error) {
			await logger.error(`获取配置键 ${key} 失败: ${error}`, error)
			return null
		}
	},
	set: async (key: ConfigKey, value: string | number | boolean, log = true) => {
		try {
			await logger.info(log ? `set配置键 ${key} 为: ${value}` : `set配置键 ${key}`)
			await invoke("set_config", {key, value})
		} catch (error) {
			await logger.error(`设置配置键 ${key} 失败: ${error}`, error)
		}
	},
	delete: async (key: ConfigKey) => {
		try {
			await logger.info(`delete配置键 ${key}`)
			await invoke("delete_config", {key})
		} catch (error) {
			await logger.error(`删除配置键 ${key} 失败: ${error}`, error)
		}
	}
}
