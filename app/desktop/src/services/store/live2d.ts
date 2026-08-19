import {ref} from "vue"
import {defineStore} from "pinia"
import {invoke} from "@tauri-apps/api/core"
import {init} from "l2d"
import {logger} from "../logger"
import {config} from "../config"
import {assetUrl} from "../asset.ts"

// Live2D 实例类型
type L2DInstance = ReturnType<typeof init>

/**
 * Live2D 模型状态管理
 */
export const useLive2DStore = defineStore("live2d", () => {
	// Live2D 实例
	const l2dInstance = ref<L2DInstance | null>(null)

	// Live2D Canvas 元素
	const canvasElement = ref<HTMLCanvasElement | null>(null)

	// 记录当前 Canvas 实际挂载的容器
	let currentContainer: HTMLElement | null = null

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

	// 模型缩放比例
	const modelScale = ref<number>(1.0)

	// 模型 X 轴位置 -2 ~ 2
	const modelX = ref<number>(0.0)

	// 模型 Y 轴位置 -2 ~ 2
	const modelY = ref<number>(0.0)

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
		// 记录当前容器
		currentContainer = container
		// 设置 ResizeObserver 监听容器尺寸变化
		setupResizeObserver(container)
	}

	/**
	 * 设置 ResizeObserver 监听容器尺寸变化
	 */
	const setupResizeObserver = (container: HTMLElement) => {
		resizeObserver = new ResizeObserver(() => {
			// 自动响应 canvas CSS 尺寸的变化并进行重绘
		})
		resizeObserver.observe(container)
	}

	/**
	 * 将 canvas 从当前容器卸载
	 * 移动到 document.body 并隐藏
	 *
	 * @param container 当前试图卸载的组件容器引用
	 */
	const detachCanvas = (container: HTMLElement) => {
		if (!canvasElement.value) return
		if (canvasElement.value.parentElement === container) {
			// 清理 ResizeObserver
			resizeObserver?.disconnect()
			resizeObserver = null
			// 从当前容器移除
			canvasElement.value.parentElement.removeChild(canvasElement.value)
			// 添加临时隐藏样式, 避免影响布局
			canvasElement.value.style.position = "fixed"
			canvasElement.value.style.left = "-9999px"
			canvasElement.value.style.top = "-9999px"
			canvasElement.value.style.width = "1px"
			canvasElement.value.style.height = "1px"
			canvasElement.value.style.opacity = "0"
			canvasElement.value.style.pointerEvents = "none"
			document.body.appendChild(canvasElement.value)
			// 清空当前容器记录
			currentContainer = null
		}
	}

	/**
	 * 应用模型渲染配置
	 */
	const applyModelTransform = async () => {
		if (!l2dInstance.value) return
		try {
			const [savedScale, savedX, savedY] = await Promise.all([
				config.get("live2d_scale"),
				config.get("live2d_pos_x"),
				config.get("live2d_pos_y"),
			])
			// 兼容 Tauri 可能返回字符串类型的数字
			modelScale.value = savedScale !== null ? Number(savedScale) : 1.0
			modelX.value = savedX !== null ? Number(savedX) : 0.0
			modelY.value = savedY !== null ? Number(savedY) : 0.0
			l2dInstance.value.setScale(modelScale.value)
			l2dInstance.value.setPosition(modelX.value, modelY.value)
		} catch (err) {
			await logger.error("应用模型渲染配置失败:", err)
		}
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
			await applyModelTransform()
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
	 * 设置模型缩放比例
	 */
	const setModelScale = async (scale: number) => {
		if (!l2dInstance.value) return
		modelScale.value = scale
		l2dInstance.value.setScale(scale)
		await config.set("live2d_scale", scale)
	}

	/**
	 * 设置模型 X, Y 轴位置并保存配置
	 */
	const setModelPosition = async (x: number, y: number) => {
		if (!l2dInstance.value) return
		modelX.value = x
		modelY.value = y
		l2dInstance.value.setPosition(x, y)
		try {
			await Promise.all([
				config.set("live2d_pos_x", x),
				config.set("live2d_pos_y", y),
			])
		} catch (err) {
			await logger.error("保存模型位置配置失败:", err)
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
		currentContainer = null
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
		currentContainer,
		l2dInstance,
		currentModel,
		isInitialized,
		isLoading,
		loadedFiles,
		totalFiles,
		error,

		// 渲染配置状态
		modelScale,
		modelX,
		modelY,

		// 核心方法
		initApp,
		loadModel,
		mountCanvas,
		detachCanvas,
		destroyApp,
		clearError,

		// 渲染控制方法
		setModelScale,
		setModelPosition,
	}
})
