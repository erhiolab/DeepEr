import {ref, computed} from "vue"
import {defineStore} from "pinia"
import {invoke} from "@tauri-apps/api/core"
import {Application, Ticker} from "pixi.js"
import {Live2DModel} from "@jannchie/pixi-live2d-display/cubism4"
import {logger} from "../logger"
import {assetUrl} from "../config.ts"

/**
 * Live2D 表情类型
 */
export type Live2DExpression = string | null

export const useLive2DStore = defineStore("live2d", () => {
	// Pixi Application
	const app = ref<Application | null>(null)

	// Pixi Canvas
	const canvas = computed<HTMLCanvasElement | null>(() => {
		return app.value?.canvas ?? null
	})

	// Live2D 模型
	const model = ref<Live2DModel | null>(null)

	// 当前模型
	const currentModel = ref<string | null>(null)

	// 当前表情
	const expression = ref<Live2DExpression>(null)

	// 当前动作
	const motion = ref<string | null>(null)

	// 是否已经初始化模型
	const isInitialized = ref(false)

	// 是否正在加载
	const isLoading = ref(false)

	// 错误信息
	const error = ref<string | null>(null)

	// 防止重复初始化
	let initializing = false

	// 模型文件基础路径
	const modelFileBase = computed(() => {
		if (!currentModel.value) return null
		return currentModel.value
	})

	// Pixi 是否已经初始化
	const isAppReady = computed(() => {
		return app.value !== null
	})

	// 初始化 Pixi Application
	const initApp = async (container?: HTMLElement): Promise<boolean> => {
		if (app.value) return true
		await logger.info("初始化 Pixi Application")
		try {
			const APPLICATION = new Application()
			await APPLICATION.init({
				backgroundAlpha: 0,
				antialias: true,
				autoDensity: true,
				resolution: window.devicePixelRatio || 1,
				resizeTo: container ?? window,
				autoStart: false,
			})
			if (container) container.appendChild(APPLICATION.canvas)

			if (container) {
				container.appendChild(APPLICATION.canvas)
				console.log("=== PIXI CANVAS ===")
				console.log(APPLICATION.canvas)
				console.log("container:", container)
				console.log("canvas parent:", APPLICATION.canvas.parentElement)
				console.log("canvas width:", APPLICATION.canvas.width)
				console.log("canvas height:", APPLICATION.canvas.height)
			}

			app.value = APPLICATION
			await logger.info("Pixi Application 初始化成功")
			return true
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err)
			await logger.error(`初始化 Pixi Application 失败: ${error.value}`)
			return false
		}
	}

	// 获取模型路径
	const getModelPath = (modelName: string) => {
		return `${assetUrl(`live2d/${modelName}`)}/${modelName}.model3.json`
	}

	// 检查模型资源
	const checkModel = async (modelName: string) => {
		const EXISTS = await invoke<boolean>("check_resource", {
			resourceType: "live2d",
			name: modelName,
		})
		if (!EXISTS) throw new Error(`模型 ${modelName} 不存在`)
	}

	// 初始化模型
	const initModel = async (modelName: string): Promise<boolean> => {
		if (isInitialized.value && currentModel.value === modelName) return true
		if (!app.value) {
			await logger.error("初始化 Live2D 模型失败: Pixi Application 尚未初始化")
			return false
		}
		if (initializing) {
			await logger.warn("Live2D 正在初始化, 忽略重复请求")
			return false
		}
		initializing = true
		isLoading.value = true
		error.value = null
		await logger.info(`初始化 Live2D 模型 ${modelName}`)
		try {
			await checkModel(modelName)
			const MODEL_PATH = getModelPath(modelName)
			await logger.info(`加载 Live2D 模型: ${MODEL_PATH}`)
			const MODEL = await Live2DModel.from(MODEL_PATH, {
				ticker: Ticker.shared,
				autoHitTest: true,
				autoFocus: true,
			})
			app.value.start()

			app.value.stage.addChild(MODEL)
			console.log("=== MODEL READY ===")
			console.log("model:", MODEL)
			console.log("stage children:", app.value.stage.children)
			console.log("canvas:", app.value.canvas)
			console.log("model visible:", MODEL.visible)
			console.log("model renderable:", MODEL.renderable)
			console.log("model alpha:", MODEL.alpha)
			console.log("model width:", MODEL.width)
			console.log("model height:", MODEL.height)

			app.value.start()
			model.value = MODEL
			currentModel.value = modelName
			expression.value = null
			motion.value = null
			isInitialized.value = true
			await logger.info(`Live2D 模型 ${modelName} 初始化成功`)
			return true
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err)
			await logger.error(`初始化 Live2D 模型 ${modelName} 失败: ${error.value}`, err)
			return false
		} finally {
			isLoading.value = false
			initializing = false
		}
	}

	// 切换模型
	const switchModel = async (modelName: string): Promise<boolean> => {
		if (currentModel.value === modelName && isInitialized.value) return true
		await logger.info(`切换 Live2D 模型 ${modelName}`)
		await destroyModel()
		return initModel(modelName)
	}

	// 播放 Motion
	const playMotion = async (
		group: string,
		index = 0,
		priority?: number,
	): Promise<boolean> => {
		if (!model.value) return false
		try {
			await model.value.motion(group, index, priority)
			motion.value = `${group}:${index}`
			return true
		} catch (err) {
			await logger.error("播放 Live2D Motion 失败:", err)
			return false
		}
	}

	// 停止 Motion
	const stopMotion = async () => {
		if (!model.value) return
		try {
			model.value.internalModel.motionManager.stopAllMotions()
			motion.value = null
		} catch (err) {
			await logger.error("停止 Live2D Motion 失败:", err)
		}
	}

	// 设置 Expression
	const setExpression = async (name: string): Promise<boolean> => {
		if (!model.value) return false
		try {
			await model.value.expression(name)
			expression.value = name
			return true
		} catch (err) {
			await logger.error("设置 Live2D Expression 失败:", err)
			return false
		}
	}

	// 开始 LipSync
	const startLipSync = async (): Promise<boolean> => {
		if (!model.value) return false
		try {
			model.value.startLipSync()
			return true
		} catch (err) {
			await logger.error("启动 Live2D LipSync 失败:", err)
			return false
		}
	}

	// 设置嘴巴开合
	const setMouth = async (value: number): Promise<boolean> => {
		if (!model.value) return false
		const VALUE = Math.max(0, Math.min(1, value))
		try {
			model.value.startLipSync()
			model.value.setLipSyncValue(VALUE)
			return true
		} catch (err) {
			await logger.error("设置 Live2D 嘴巴开合失败:", err)
			return false
		}
	}

	// 停止 LipSync
	const stopLipSync = async (): Promise<boolean> => {
		if (!model.value) return false
		try {
			model.value.stopLipSync()
			return true
		} catch (err) {
			await logger.error("停止 Live2D LipSync 失败:", err)
			return false
		}
	}

	// 语音播放 + 自动 LipSync
	const speak = async (audio: HTMLAudioElement | string): Promise<boolean> => {
		if (!model.value) return false
		try {
			await model.value.speak(audio)
			return true
		} catch (err) {
			await logger.error("Live2D 语音播放失败:", err)
			return false
		}
	}

	// 销毁模型
	const destroyModel = async () => {
		if (!model.value) {
			currentModel.value = null
			isInitialized.value = false
			return
		}
		await logger.info("销毁 Live2D 模型")
		try {
			model.value.stopSpeaking?.()
			model.value.stopLipSync?.()
			model.value.destroy()
		} catch (err) {
			await logger.error("销毁 Live2D 模型失败:", err)
		}
		model.value = null
		currentModel.value = null
		expression.value = null
		motion.value = null
		isInitialized.value = false
	}

	// 销毁整个 Pixi Application
	const destroyApp = async () => {
		await destroyModel()
		if (!app.value) return
		await logger.info("销毁 Pixi Application")
		try {
			app.value.destroy(true)
		} catch (err) {
			await logger.error("销毁 Pixi Application 失败:", err)
		}
		app.value = null
	}

	// 清除错误
	const clearError = () => {
		error.value = null
	}

	return {
		app,
		canvas,
		model,

		currentModel,
		expression,
		motion,

		isInitialized,
		isLoading,
		error,

		modelFileBase,
		isAppReady,

		initApp,
		initModel,
		switchModel,
		destroyModel,
		destroyApp,

		playMotion,
		stopMotion,

		setExpression,

		startLipSync,
		setMouth,
		stopLipSync,
		speak,

		clearError,
	}
})