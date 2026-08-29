/**
 * 定时任务状态 (列表 + 下一个任务 + 到点触发)
 *
 * 到点由 Rust 调度线程 emit `scheduled-task-due`, 这里监听后:
 * 1. 在聊天流插入中间提示「⏰ 定时任务「xxx」」
 * 2. 把任务内容通过对话消息队列发给 AI (不打断正在进行的回复)
 */
import {ref} from "vue"
import {defineStore} from "pinia"
import {listen} from "@tauri-apps/api/event"
import {
	getNextTask,
	listTasks,
	type NextTaskInfo,
	type TaskDefinition,
} from "../schedule"
import {useConversationStore} from "./conversation"

// 下一个任务展示的刷新间隔 (秒)
const NEXT_REFRESH_MS = 30_000

/**
 * 定时任务状态 (列表 + 下一个任务 + 到点触发)
 */
export const useScheduleStore = defineStore("schedule", () => {
	// 全部任务
	const tasks = ref<TaskDefinition[]>([])

	// 下一个要执行的任务
	const nextTask = ref<NextTaskInfo | null>(null)

	// 是否已初始化 (只注册一次监听)
	const initialized = ref(false)

	// 轮询定时器
	let pollTimer: ReturnType<typeof setInterval> | null = null

	// 刷新任务列表与下一个任务
	const refresh = async (): Promise<void> => {
		tasks.value = await listTasks()
		nextTask.value = await getNextTask()
	}

	/**
	 * 初始化: 注册到点事件 + 拉取列表 + 轮询下一个任务
	 */
	const init = async (): Promise<void> => {
		if (initialized.value) return
		initialized.value = true
		await listen<{id: number, title: string, content: string}>("scheduled-task-due", event => {
			const CONV = useConversationStore()
			CONV.sendScheduled(event.payload.title, event.payload.content)
			void refresh()
		})
		await refresh()
		pollTimer = setInterval(() => {
			void getNextTask().then(info => {
				nextTask.value = info
			})
		}, NEXT_REFRESH_MS)
	}

	/**
	 * 停止轮询 (应用生命周期内一般不需要调用)
	 */
	const dispose = (): void => {
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	}

	return {
		tasks,
		nextTask,
		initialized,
		init,
		refresh,
		dispose,
	}
})
