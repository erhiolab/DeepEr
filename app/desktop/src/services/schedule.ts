/**
 * 定时任务 API 层
 *
 * 数据在后端 tasks 表, 调度线程在 Rust 侧持续运行, 到点 emit `scheduled-task-due`.
 * 前端只负责增删改查、展示「下一个任务」与到点后把内容发给 AI.
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * 一条时间设定:
 * - once  : 一次性 (at 为 Unix 秒)
 * - hourly: 每小时的 minute 分
 * - daily : 每天 time (HH:MM)
 * - weekly: 每周 weekdays (1=周一..7=周日) 的 time (HH:MM)
 */
export type ScheduleEntry =
	| {type: "once", at: number}
	| {type: "hourly", minute: number}
	| {type: "daily", time: string}
	| {type: "weekly", weekdays: number[], time: string}

/**
 * 定时任务记录 (与后端 TaskRecord camelCase 对齐)
 */
export interface TaskDefinition {
	id: number
	title: string
	content: string
	kind: "permanent" | "once"
	schedule: ScheduleEntry[]
	enabled: boolean
	createdAt: number
	updatedAt: number
}

/**
 * 任务写入参数
 */
export interface TaskInput {
	title: string
	content: string
	kind: "permanent" | "once"
	schedule: ScheduleEntry[]
}

/**
 * 下一个要执行的任务
 */
export interface NextTaskInfo {
	task: TaskDefinition
	at: number
}

/**
 * 全部任务
 */
export const listTasks = async (): Promise<TaskDefinition[]> => {
	try {
		return await invoke<TaskDefinition[]>("task_list")
	} catch (error) {
		await logger.error("[schedule] 获取定时任务列表失败", error)
		return []
	}
}

/**
 * 新建任务
 */
export const createTask = async (input: TaskInput): Promise<TaskDefinition | null> => {
	try {
		return await invoke<TaskDefinition>("task_create", {args: input})
	} catch (error) {
		await logger.error("[schedule] 创建定时任务失败", error)
		return null
	}
}

/**
 * 更新任务
 */
export const updateTask = async (id: number, input: TaskInput): Promise<TaskDefinition | null> => {
	try {
		return await invoke<TaskDefinition>("task_update", {id, args: input})
	} catch (error) {
		await logger.error("[schedule] 更新定时任务失败", error)
		return null
	}
}

/**
 * 删除任务
 */
export const deleteTask = async (id: number): Promise<boolean> => {
	try {
		await invoke("task_delete", {id})
		return true
	} catch (error) {
		await logger.error("[schedule] 删除定时任务失败", error)
		return false
	}
}

/**
 * 切换任务启用状态
 */
export const setTaskEnabled = async (id: number, enabled: boolean): Promise<boolean> => {
	try {
		await invoke("task_set_enabled", {id, enabled})
		return true
	} catch (error) {
		await logger.error("[schedule] 切换定时任务状态失败", error)
		return false
	}
}

/**
 * 下一个要执行的任务
 */
export const getNextTask = async (): Promise<NextTaskInfo | null> => {
	try {
		return await invoke<NextTaskInfo | null>("task_next")
	} catch (error) {
		await logger.error("[schedule] 获取下一个定时任务失败", error)
		return null
	}
}
