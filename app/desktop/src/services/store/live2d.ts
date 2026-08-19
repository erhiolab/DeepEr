import {ref} from "vue"
import {defineStore} from "pinia"
import {invoke} from "@tauri-apps/api/core"
import {init} from "l2d"
import {logger} from "../logger"
import {assetUrl} from "../config.ts"

type L2DInstance = ReturnType<typeof init>

/**
 * Live2D 模型状态管理
 */
export const useLive2DStore = defineStore("live2d", () => {
	// Live2D 实例
	const l2dInstance = ref<L2DInstance | null>(null)

	// Live2D Canvas 元素
	const canvasElement = ref<HTMLCanvasElement | null>(null)

	// 当前模型名称
	const currentModel = ref<string | null>(null)

	// 是否已初始化模型
	const isInitialized = ref(false)

	// 是否正在加载
	const isLoading = ref(false)

	// 已加载文件数量
	const loadedFiles = ref(0)

	// 总文件数量
	const totalFiles = ref(0)

	// 错误信息
	const error = ref<string | null>(null)

	// 防止重复初始化的锁
	let isInitializing = false

	// ResizeObserver 实例, 用于监听容器尺寸变化
	let resizeObserver: ResizeObserver | null = null

	// 获取模型文件路径
	const getModelPath = (modelName: string) => {
		return `${assetUrl(`live2d/${modelName}`)}/${modelName}.model3.json`
	}

	// 检查模型资源是否存在
	const checkModel = async (modelName: string) => {
		const EXISTS = await invoke<boolean>("check_resource", {
			resourceType: "live2d",
			name: modelName,
		})
		if (!EXISTS) throw new Error(`模型 ${modelName} 不存在`)
	}

	/**
	 * 初始化 Live2D 模型
	 * 全局只初始化一次, 后续调用直接返回
	 */
	const initApp = async (): Promise<boolean> => {
		if (l2dInstance.value) return true
		if (isInitializing) {
			await logger.warn("Live2D 正在初始化, 忽略重复请求")
			return false
		}
		isInitializing = true
		isLoading.value = true
		error.value = null
		await logger.info("初始化 Live2D")
		try {
			// 创建全局唯一的 canvas 元素
			const CANVAS = document.createElement("canvas")
			CANVAS.style.width = "100%"
			CANVAS.style.height = "100%"
			CANVAS.style.display = "block"
			canvasElement.value = CANVAS
			// 创建 L2D 实例并绑定 canvas
			const INSTANCE = init(CANVAS)
			l2dInstance.value = INSTANCE
			// 监听 l2d 库的加载进度事件
			INSTANCE.on("loadstart", (total: number) => {
				totalFiles.value = total
				loadedFiles.value = 0
			})
			INSTANCE.on("loadprogress", (loaded: number, total: number) => {
				loadedFiles.value = loaded
				totalFiles.value = total
			})
			await logger.info("Live2D 实例初始化成功")
			return true
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err)
			await logger.error(`初始化 Live2D 实例失败: ${error.value}`)
			return false
		} finally {
			isLoading.value = false
			isInitializing = false
		}
	}

	/**
	 * 将 canvas 挂载到指定容器
	 * 用于路由切换时保留 canvas 实例
	 */
	const mountCanvas = async (container: HTMLElement) => {
		if (!canvasElement.value) {
			await logger.warn("Canvas 尚未创建, 请先调用 initApp")
			return
		}
		if (canvasElement.value.parentElement === container) {
			// 已经在目标容器中, 只只需确保 ResizeObserver 正常工作
			setupResizeObserver(container)
			return
		}
		// 清理旧的 observer
		resizeObserver?.disconnect()
		// 如果 canvas 在其他容器中, 先移除
		if (canvasElement.value.parentElement) {
			canvasElement.value.parentElement.removeChild(canvasElement.value)
		}
		// 清除 detachCanvas 设置的临时隐藏样式
		canvasElement.value.style.position = ""
		canvasElement.value.style.left = ""
		canvasElement.value.style.top = ""
		canvasElement.value.style.width = "100%"
		canvasElement.value.style.height = "100%"
		canvasElement.value.style.opacity = "1"
		canvasElement.value.style.pointerEvents = "auto"
		// 添加到新容器
		container.appendChild(canvasElement.value)
		// 设置 ResizeObserver 监听容器尺寸变化
		setupResizeObserver(container)
	}

	/**
	 * 设置 ResizeObserver 监听容器尺寸变化
	 */
	const setupResizeObserver = (container: HTMLElement) => {
		resizeObserver = new ResizeObserver(() => {
		})
		resizeObserver.observe(container)
	}

	/**
	 * 将 canvas 从当前容器卸载
	 * 移动到 document.body 并隐藏
	 */
	const detachCanvas = () => {
		if (!canvasElement.value) return
		// 清理 ResizeObserver
		resizeObserver?.disconnect()
		resizeObserver = null
		if (canvasElement.value.parentElement) {
			canvasElement.value.parentElement.removeChild(canvasElement.value)
		}
		// 添加临时样式
		canvasElement.value.style.position = "fixed"
		canvasElement.value.style.left = "-9999px"
		canvasElement.value.style.top = "-9999px"
		canvasElement.value.style.width = "1px"
		canvasElement.value.style.height = "1px"
		canvasElement.value.style.opacity = "0"
		canvasElement.value.style.pointerEvents = "none"
		document.body.appendChild(canvasElement.value)
	}

	/**
	 * 加载或切换 Live2D 模型
	 */
	const loadModel = async (modelName: string): Promise<boolean> => {
		if (!l2dInstance.value) {
			await logger.error("加载模型失败: Live2D 实例尚未初始化")
			return false
		}
		if (isInitialized.value && currentModel.value === modelName) return true
		isLoading.value = true
		error.value = null
		await logger.info(`加载 Live2D 模型: ${modelName}`)
		try {
			// 检查模型资源
			await checkModel(modelName)
			const MODEL_PATH = getModelPath(modelName)
			await logger.info(`模型路径: ${MODEL_PATH}`)
			await l2dInstance.value.load({
				path: MODEL_PATH,
			})
			currentModel.value = modelName
			isInitialized.value = true
			await logger.info(`Live2D 模型 ${modelName} 加载成功`)
			return true
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err)
			await logger.error(`加载 Live2D 模型 ${modelName} 失败: ${error.value}`, err)
			return false
		} finally {
			isLoading.value = false
		}
	}

	/**
	 * 销毁 Live2D 实例
	 */
	const destroyApp = async () => {
		if (!l2dInstance.value) return
		await logger.info("销毁 Live2D 实例")
		if (typeof (l2dInstance.value as any).destroy === "function") {
			(l2dInstance.value as any).destroy()
		}
		// 清理 ResizeObserver
		resizeObserver?.disconnect()
		resizeObserver = null
		if (canvasElement.value && canvasElement.value.parentElement) {
			canvasElement.value.parentElement.removeChild(canvasElement.value)
		}
		l2dInstance.value = null
		canvasElement.value = null
		currentModel.value = null
		isInitialized.value = false
		loadedFiles.value = 0
		totalFiles.value = 0
		error.value = null
	}

	/**
	 * 清除错误状态
	 */
	const clearError = () => {
		error.value = null
	}

	return {
		// 状态
		canvas: canvasElement,
		l2dInstance,
		currentModel,
		isInitialized,
		isLoading,
		loadedFiles,
		totalFiles,
		error,

		// 核心方法
		initApp,
		loadModel,
		mountCanvas,
		detachCanvas,
		destroyApp,
		clearError,
	}
})
