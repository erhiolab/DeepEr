import {defineStore} from "pinia"
import {ref, computed} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {load, stop} from "live2d-easy-control"
import {logger} from "../logger"
import {assetUrl} from "../config"

/**
 * Live2D 模型状态管理
 */
export const useLive2DStore = defineStore("live2d", () => {
	// 当前模型
	const currentModel = ref<string | null>(null)
	// Live2D Canvas
	const canvas = ref<HTMLCanvasElement | null>(null)
	// 是否初始化
	const isInitialized = ref(false)
	// 是否加载中
	const isLoading = ref(false)
	// 错误信息
	const error = ref<string | null>(null)

	// 模型文件基础路径
	const modelFileBase = computed(() => {
		if (!currentModel.value) return null
		return currentModel.value
	})

	// 构建加载配置
	const buildLoadConfig = (model: string) => ({
		modelDir: model,
		resourcesPath: `${assetUrl(`live2d/${model}`)}/`,
		canvasSize: "auto" as const,
		canvasWidth: "100%",
		canvasHeight: "100%",
	})

	// 查找 Live2D Canvas
	const findCanvas = (): HTMLCanvasElement | null => {
		const CANVASES = document.querySelectorAll("canvas")
		return CANVASES[CANVASES.length - 1] ?? null
	}

	// 初始化 Live2D 模型
	const initModel = async (modelName: string): Promise<boolean> => {
		await logger.info(`初始化 Live2D 模型 ${modelName}`)
		isLoading.value = true
		error.value = null
		try {
			const EXISTS = await invoke<boolean>("check_resource", {
				resourceType: "live2d",
				name: modelName,
			})
			if (!EXISTS) {
				error.value = `模型 ${modelName} 不存在`
				await logger.error(`模型 ${modelName} 不存在`)
				return false
			}
			await load(buildLoadConfig(modelName))
			const CANVAS = findCanvas()
			if (!CANVAS) {
				error.value = "Live2D Canvas 创建失败"
				await logger.error("Live2D Canvas 创建失败")
				return false
			}
			canvas.value = CANVAS
			currentModel.value = modelName
			isInitialized.value = true
			await logger.info(`Live2D 模型 ${modelName} 初始化成功`)
			return true
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err)
			await logger.error(`初始化 Live2D 模型 ${modelName} 失败: ${error.value}`)
			return false
		} finally {
			isLoading.value = false
		}
	}

	// 切换 Live2D 模型
	const switchModel = async (modelName: string): Promise<boolean> => {
		await logger.info(`切换 Live2D 模型 ${modelName}`)
		await destroyModel()
		return initModel(modelName)
	}

	// 销毁 Live2D 模型
	const destroyModel = async () => {
		await logger.info("销毁 Live2D 模型")
		try {
			await stop()
		} catch (err) {
			await logger.error("销毁 Live2D 模型失败:", err)
		}
		canvas.value?.remove()
		canvas.value = null
		currentModel.value = null
		isInitialized.value = false
		error.value = null
	}

	// 清除错误信息
	const clearError = () => {
		error.value = null
	}

	return {
		// 状态
		currentModel,
		canvas,
		isInitialized,
		isLoading,
		error,

		// 计算属性
		modelFileBase,

		// 方法
		initModel,
		switchModel,
		destroyModel,
		clearError,
	}
})