import {computed, reactive, readonly} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {listen, type UnlistenFn} from "@tauri-apps/api/event"
import {toast} from "vue3-toastify"
import useLanguages from "./i18n/useLanguages.ts"
import {logger} from "./logger"

const I18N = computed(() => useLanguages().common.download)

/**
 * 资源导入 Service.
 *
 * 监听后端 `resource-import` 事件, 驱动 `import_live2d` 命令.
 * 与 resourceDownload 相似的状态机, 但进度字段用 `processed` (已处理字节).
 */

/**
 * 资源导入流程阶段
 */
export type ResourceImportStep =
	| "idle" // 尚未开始
	| "importing" // 复制中 (percent 实时)
	| "done" // 就绪
	| "error" // 出错

/**
 * 资源导入状态
 */
export interface ResourceImportState {
	step: ResourceImportStep
	percent: number
	processed: number | null
	total: number | null
	message: string | null
}

/**
 * 资源导入事件负载
 */
interface ResourceImportEventPayload {
	resourceType: string
	step: string
	progress?: number | null
	processed?: number | null
	total?: number | null
	message?: string | null
}

const EVENT_NAME = "resource-import"

/**
 * 创建资源导入服务
 */
export const createResourceImport = () => {
	const STATE = reactive<ResourceImportState>({
		step: "idle",
		percent: 0,
		processed: null,
		total: null,
		message: null,
	})

	let unlisten: UnlistenFn | null = null

	const apply = async (payload: ResourceImportEventPayload) => {
		const {step, processed, total, message} = payload
		switch (step) {
			case "importing":
				STATE.step = "importing"
				STATE.processed = processed ?? null
				STATE.total = total ?? null
				STATE.percent = Math.min(99, payload.progress ?? 0)
				STATE.message = null
				break
			case "done":
				STATE.step = "done"
				STATE.percent = 100
				STATE.processed = null
				STATE.total = null
				STATE.message = null
				break
			case "error":
				STATE.step = "error"
				STATE.message = message ?? null
				STATE.percent = 100
				toast.error(message || I18N.value.downloadFailed)
				await logger.error(`导入失败: ${message ?? "未知错误"}`)
				break
			default:
				break
		}
	}

	const onEvent = (e: { payload: ResourceImportEventPayload }): void => {
		void apply(e.payload)
	}

	const reset = (): void => {
		STATE.step = "idle"
		STATE.percent = 0
		STATE.processed = null
		STATE.total = null
		STATE.message = null
	}

	// 触发导入: 立即返回; 结果通过 resource-import 的 done / error 事件驱动
	// sourceType: dir(文件夹) / zip(压缩包) / model(单个入口 json)
	const importModel = async (sourcePath: string, sourceType: "dir" | "zip" | "model" = "dir"): Promise<void> => {
		reset()
		unlisten?.()
		unlisten = await listen<ResourceImportEventPayload>(EVENT_NAME, onEvent)
		try {
			await invoke("import_live2d", {sourcePath, sourceType})
		} catch (error) {
			toast.error(I18N.value.downloadFailed)
			await logger.error(`导入模型失败: ${sourcePath}`, error)
			STATE.step = "error"
			STATE.message = String(error)
		}
	}

	const stop = (): void => {
		unlisten?.()
		unlisten = null
	}

	return {state: readonly(STATE), importModel, reset, stop}
}
