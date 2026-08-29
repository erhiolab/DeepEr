/**
 * 主页统计 API 层
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * 某天消息数 (图表)
 */
export interface DailyActivity {
	day: string
	messages: number
	tokens: number
}

/**
 * 主页统计数据 (与后端 HomeStats camelCase 对齐)
 */
export interface HomeStats {
	totalMessages: number
	userMessages: number
	assistantMessages: number
	todayMessages: number
	totalInputTokens: number
	totalOutputTokens: number
	todayInputTokens: number
	todayOutputTokens: number
	avgHitRate: number | null
	memoryCount: number
	toolCount: number
	enabledTaskCount: number
	nextTaskTitle: string | null
	nextTaskAt: number | null
	dailyActivity: DailyActivity[]
}

/**
 * 获取主页统计
 */
export const getHomeStats = async (): Promise<HomeStats | null> => {
	try {
		return await invoke<HomeStats>("stats_home")
	} catch (error) {
		await logger.error("[stats] 获取主页统计失败", error)
		return null
	}
}
