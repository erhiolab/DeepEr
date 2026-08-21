import {ref, computed} from "vue"
import {defineStore} from "pinia"
import {invoke} from "@tauri-apps/api/core"
import {init} from "l2d"
import {logger} from "../logger"
import {assetUrl} from "../asset.ts"
import useLanguages from "../i18n/useLanguages.ts"
import {useTouchStore, TAP_MAX_DISTANCE, SWIPE_MIN_DISTANCE, FRENZY_MIN_CLICKS, FRENZY_WINDOW_MS, type TouchType} from "./touch"

// Live2D 实例类型
type L2DInstance = ReturnType<typeof init>

/**
 * Live2D 模型状态管理
 */
export const useLive2DStore = defineStore("live2d", () => {
	// 界面文案 (随语言响应式)
	const I18N = computed(() => useLanguages().components.live2d)

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

	// 是否显示可触摸区域 (hit area) 边界调试覆盖层
	const showHitAreas = ref(false)

	// 自定义触摸检测: 当前拖拽起点 (相对 canvas 归一化) 与累计位移
	let touchStart = {x: 0, y: 0, dist: 0}

	// 自定义触摸检测: 是否正在拖拽 (相对 canvas 归一化)
	let touchDownOnCanvas = false

	// hit area 覆盖层 canvas (绘制各可触摸区域边界与名称)
	let overlayCanvas: HTMLCanvasElement | null = null

	// hit area 覆盖层渲染上下文
	let overlayCtx: CanvasRenderingContext2D | null = null

	// hit area 绘制循环的 rAF id
	let hitAreaRafId = 0

	// 已安装模型的入口文件映射: 模型名 -> 入口文件相对路径 (如 "arg-nori.model3.json")
	// 用于支持 Cubism2 (.model.json) 与 Cubism3 (.model3.json) 的加载
	const modelEntryFiles = ref<Record<string, string>>({})

	// 刷新已安装模型入口文件映射 (调用 list_resources)
	const refreshInstalled = async (): Promise<void> => {
		try {
			const LIST = await invoke<{ name: string; entryFile?: string | null }[]>("list_resources", {resourceType: "live2d"})
			const MAP: Record<string, string> = {}
			for (const ITEM of LIST) {
				if (ITEM.entryFile) MAP[ITEM.name] = ITEM.entryFile
			}
			modelEntryFiles.value = MAP
		} catch (err) {
			await logger.error("读取已安装模型入口失败:", err)
		}
	}

	// 获取模型文件路径 (使用后端探测到的入口文件)
	const getModelPath = (modelName: string, entryFile: string) => {
		const REL = entryFile.replace(/\\/g, "/").replace(/^\/+/, "")
		return `${assetUrl(`live2d/${modelName}`)}/${REL}`
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
			// 绑定自定义触摸检测 (document 级委托, 全局一次)
			setupCustomTouchDetection()
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
	const mountCanvas = async (container: HTMLElement | null) => {
		if (!container) {
			// 组件可能已卸载 (路由切换时 await 初始化期间 ref 被置空), 直接跳过挂载
			await logger.warn("Canvas 挂载失败: 容器引用为空 (组件可能已卸载)")
			return
		}
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
	 * 容器尺寸变化时调用 l2d 的 resize() 重新适配渲染 (节流到下一帧, 避免缩放中密集触发)
	 */
	const setupResizeObserver = (container: HTMLElement) => {
		let rafId = 0
		resizeObserver = new ResizeObserver(() => {
			// 用 rAF 合并同一帧内的多次的尺寸变化, 减少缩放时的重绘抖动
			if (rafId) return
			rafId = requestAnimationFrame(() => {
				rafId = 0
				l2dInstance.value?.resize()
			})
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
	 * 从模型级配置文件 (model.config.json) 读取, 数据库不再保存渲染信息
	 */
	const applyModelTransform = async () => {
		if (!l2dInstance.value) return
		try {
			const TOUCH = useTouchStore()
			// 确保已加载当前模型的触摸配置
			if (TOUCH.modelName !== currentModel.value) {
				if (currentModel.value) {
					await TOUCH.load(currentModel.value)
				}
			}
			const R = TOUCH.render
			modelScale.value = R.scale || 1.0
			modelX.value = R.posX || 0.0
			modelY.value = R.posY || 0.0
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
			// 获取入口文件 (Cubism2 / Cubism3), 缓存里没有则刷新已安装列表
			let entryFile = modelEntryFiles.value[modelName]
			if (!entryFile) {
				await refreshInstalled()
				entryFile = modelEntryFiles.value[modelName]
			}
			if (!entryFile) {
				throw new Error(`模型 ${modelName} 缺少入口文件信息`)
			}
			const MODEL_PATH = getModelPath(modelName, entryFile)
			await logger.info(`模型路径: ${MODEL_PATH}, 入口: ${entryFile}`)
			await l2dInstance.value.load({
				path: MODEL_PATH,
			})
			currentModel.value = modelName
			isInitialized.value = true
			await applyModelTransform()
			// 若开启了显示可触摸区域但此前实例未就绪, 在这里重新启动绘制
			if (showHitAreas.value && l2dInstance.value && !hitAreaRafId) {
				ensureHitAreaOverlay()
				await drawHitAreas()
			}
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
		// 渲染配置写入模型级配置文件 (随模型一起保存), 不再写全局数据库
		await useTouchStore().setRender({scale})
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
			await useTouchStore().setRender({posX: x, posY: y})
		} catch (err) {
			await logger.error("保存模型位置配置失败:", err)
		}
	}

	/**
	 * 创建 hit area 覆盖层 canvas
	 * 采用 absolute 铺满主 Canvas 所在容器, 天然与模型对齐, 避免 fixed/视口换算带来的遮蔽问题
	 */
	const ensureHitAreaOverlay = () => {
		if (overlayCanvas) return
		const CANVAS = document.createElement("canvas")
		CANVAS.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;"
		overlayCanvas = CANVAS
		overlayCtx = CANVAS.getContext("2d")
		// 若主 Canvas 已在某容器中, 立即归位
		const HOST = canvasElement.value?.parentElement
		if (HOST) HOST.appendChild(CANVAS)
	}

	/**
	 * 清除 hit area 覆盖层并停止绘制
	 */
	const clearHitAreaOverlay = () => {
		if (hitAreaRafId) {
			cancelAnimationFrame(hitAreaRafId)
			hitAreaRafId = 0
		}
		overlayCtx?.clearRect(0, 0, overlayCanvas?.width ?? 0, overlayCanvas?.height ?? 0)
		if (overlayCanvas && overlayCanvas.parentElement) {
			overlayCanvas.parentElement.removeChild(overlayCanvas)
		}
		overlayCanvas = null
		overlayCtx = null
	}

	/**
	 * 判断坐标 (viewport) 是否落在主 Canvas 内, 返回归一化坐标或 null
	 */
	const pointInCanvas = (clientX: number, clientY: number) => {
		const CANVAS = canvasElement.value
		if (!CANVAS) return null
		const R = CANVAS.getBoundingClientRect()
		if (R.width <= 0 || R.height <= 0) return null
		if (clientX < R.left || clientX > R.right || clientY < R.top || clientY > R.bottom) return null
		return {
			x: (clientX - R.left) / R.width,
			y: (clientY - R.top) / R.height,
		}
	}

	/**
	 * 命中检测: 判断归一化点是否落在某个自定义触摸区域矩形内
	 */
	const hitTouchArea = (x: number, y: number, px: number, py: number, pw: number, ph: number) => x >= px && x <= px + pw && y >= py && y <= py + ph

	/**
	 * 遍历当前模型的所有自定义触摸区域, 命中则触发回调
	 */
	const dispatchTouch = async (type: TouchType, x: number, y: number) => {
		const TOUCH = useTouchStore()
		for (const AREA of TOUCH.touches) {
			if (AREA.type !== type) continue
			if (hitTouchArea(x, y, AREA.x, AREA.y, AREA.w, AREA.h)) {
				await TOUCH.trigger(AREA)
				break
			}
		}
	}

	// 狂点 (frenzy) 检测状态: 记录每个区域窗口期内的点击次数与最近一次时间
	const frenzyState = new Map<string, {count: number; lastAt: number}>()

	/**
	 * 自定义触摸检测: 挖拽起点 (相对 canvas 归一化) 与累计位移
	 * @param e 指针事件对象
	 */
	const onTouchPointerDown = (e: PointerEvent) => {
		const P = pointInCanvas(e.clientX, e.clientY)
		if (!P) return
		touchDownOnCanvas = true
		touchStart = {x: P.x, y: P.y, dist: 0}
	}

	/**
	 * 自定义触摸检测: 移动累计位移 (相对 canvas 归一化)
	 * @param e 指针事件对象
	 */
	const onTouchPointerMove = (e: PointerEvent) => {
		if (!touchDownOnCanvas) return
		const P = pointInCanvas(e.clientX, e.clientY)
		if (!P) return
		touchStart.dist += Math.hypot(e.movementX, e.movementY)
	}

	/**
	 * 自定义触摸检测: 松开拖拽 (相对 canvas 归一化)
	 * @param e 指针事件对象
	 */
	const onTouchPointerUp = (e: PointerEvent) => {
		if (!touchDownOnCanvas) return
		touchDownOnCanvas = false
		const P = pointInCanvas(e.clientX, e.clientY)
		if (!P) return
		const NOW = Date.now()
		// 狂点: 命中任意 frenzy 区域且窗口期内连续点击达到次数 → 触发
		const TOUCH = useTouchStore()
		let frenzyFired = false
		for (const AREA of TOUCH.touches) {
			if (AREA.type !== "frenzy") continue
			if (!hitTouchArea(P.x, P.y, AREA.x, AREA.y, AREA.w, AREA.h)) continue
			const S = frenzyState.get(AREA.id)
			// 超出窗口期则重新计数
			if (!S || NOW - S.lastAt > FRENZY_WINDOW_MS) {
				frenzyState.set(AREA.id, {count: 1, lastAt: NOW})
			} else {
				S.count += 1
				S.lastAt = NOW
				if (S.count >= FRENZY_MIN_CLICKS) {
					void TOUCH.trigger(AREA)
					// 触发后重置该区域计数, 避免持续触发
					frenzyState.set(AREA.id, {count: 0, lastAt: NOW})
					frenzyFired = true
				}
			}
		}
		// 普通类型判定 (狂点区域优先, 已触发则不重复走 tap/swipe)
		if (!frenzyFired) {
			// 移动累计超过阈值 → 磨蹭; 否则视为点击
			if (touchStart.dist >= SWIPE_MIN_DISTANCE) {
				void dispatchTouch("swipe", P.x, P.y)
			} else if (touchStart.dist <= TAP_MAX_DISTANCE) {
				void dispatchTouch("tap", P.x, P.y)
			}
		}
		touchStart.dist = 0
	}

	/**
	 * 绑定自定义触摸检测 (document 级委托, 调用一次即可)
	 * 在主 canvas 上的点击/磨蹭将命中自定义触摸区域并触发回调
	 */
	const setupCustomTouchDetection = () => {
		document.addEventListener("pointerdown", onTouchPointerDown)
		document.addEventListener("pointermove", onTouchPointerMove)
		document.addEventListener("pointerup", onTouchPointerUp)
	}

	/**
	 * 解绑自定义触摸检测 (document 级委托, 调用一次即可)
	 */
	const teardownCustomTouchDetection = () => {
		document.removeEventListener("pointerdown", onTouchPointerDown)
		document.removeEventListener("pointermove", onTouchPointerMove)
		document.removeEventListener("pointerup", onTouchPointerUp)
		touchDownOnCanvas = false
	}

	/**
	 * 逐帧绘制 hit area 边界
	 * 覆盖层与主 Canvas 同容器对齐, 直接复用 canvas 的物理尺寸, 无需视口换算
	 */
	const drawHitAreas = async () => {
		// 关闭时停止循环
		if (!showHitAreas.value || !overlayCtx) {
			hitAreaRafId = 0
			return
		}
		hitAreaRafId = requestAnimationFrame(drawHitAreas)
		const CANVAS = canvasElement.value
		if (!CANVAS || !l2dInstance.value) return
		// 主 Canvas 被 detach 到 body 隐藏时不绘制
		const RECT = CANVAS.getBoundingClientRect()
		if (RECT.left < -1000 || RECT.top < -1000 || RECT.width <= 0 || RECT.height <= 0) {
			overlayCtx.clearRect(0, 0, overlayCanvas?.width ?? 0, overlayCanvas?.height ?? 0)
			return
		}
		// 确保覆盖层与主 Canvas 处于同一父容器 (路由切换时容器会变化)
		if (overlayCanvas!.parentElement !== CANVAS.parentElement) {
			CANVAS.parentElement?.appendChild(overlayCanvas!)
		}
		// 直接用 canvas 的 backing store 尺寸, 与 getHitAreaBounds 的归一化一致
		const W = CANVAS.width
		const H = CANVAS.height
		if (overlayCanvas!.width !== W || overlayCanvas!.height !== H) {
			overlayCanvas!.width = W
			overlayCanvas!.height = H
		}
		overlayCtx.clearRect(0, 0, W, H)
		// 遍历所有 hit area, 绘制边界矩形与名称标签 (个别模型读取 bounds 可能抛错, 兜底不影响主循环)
		let BOUNDS: {name: string; x: number; y: number; w: number; h: number}[] = []
		try {
			BOUNDS = l2dInstance.value.getHitAreaBounds()
		} catch (err) {
			await logger.error("读取可触摸区域失败:", err)
			return
		}
		for (const B of BOUNDS) {
			const X = B.x * W
			const Y = B.y * H
			const BW = B.w * W
			const BH = B.h * H
			overlayCtx.strokeStyle = "rgba(0,255,100,0.9)"
			overlayCtx.lineWidth = 2
			overlayCtx.strokeRect(X, Y, BW, BH)
			overlayCtx.fillStyle = "rgba(0,255,100,0.12)"
			overlayCtx.fillRect(X, Y, BW, BH)
			overlayCtx.fillStyle = "rgba(0,255,100,1)"
			overlayCtx.font = "bold 12px monospace"
			overlayCtx.fillText(B.name, X + 4, Y + 14)
		}
		// 叠加绘制用户自定义触摸区域 (蓝色)
		const TOUCH = useTouchStore()
		for (const T of TOUCH.touches) {
			const X = T.x * W
			const Y = T.y * H
			const BW = T.w * W
			const BH = T.h * H
			// tap=蓝 / swipe=橙 / frenzy=品红
			const COLOR = T.type === "swipe" ? "rgba(255,170,60," : T.type === "frenzy" ? "rgba(255,80,200," : "rgba(80,160,255,"
			overlayCtx.strokeStyle = COLOR + "0.95)"
			overlayCtx.lineWidth = 2
			overlayCtx.strokeRect(X, Y, BW, BH)
			overlayCtx.fillStyle = COLOR + "0.15)"
			overlayCtx.fillRect(X, Y, BW, BH)
			overlayCtx.fillStyle = "rgba(255,255,255,0.95)"
			overlayCtx.font = "bold 12px monospace"
			const TAG = T.type === "swipe" ? ` (${I18N.value.tagSwipe})` : T.type === "frenzy" ? ` (${I18N.value.tagFrenzy})` : ""
			overlayCtx.fillText(`${T.name}${TAG}`, X + 4, Y + 28)
		}
	}

	/**
	 * 设置是否显示可触摸区域 (hit area)
	 * @param show true 开启绘制, false 停止并清理覆盖层
	 */
	const setShowHitAreas = async (show: boolean) => {
		showHitAreas.value = show
		if (show) {
			// 实例未就绪时仅记录状态, 模型加载完成后会自动启动绘制
			if (!l2dInstance.value) return
			ensureHitAreaOverlay()
			if (!hitAreaRafId) await drawHitAreas()
		} else {
			clearHitAreaOverlay()
		}
	}

	/**
	 * 销毁 Live2D 实例
	 */
	/**
	 * 刷新(重新加载)当前 Live2D 模型
	 * 保留 canvas 与实例, 仅强制重新加载当前已应用的模型
	 */
	const reloadModel = async (): Promise<boolean> => {
		if (!currentModel.value) {
			await logger.warn("刷新 Live2D 失败: 尚未应用任何模型")
			return false
		}
		const NAME = currentModel.value
		// 绕过相同模型的短路判断, 强制走一遍加载流程
		isInitialized.value = false
		return loadModel(NAME)
	}

	const destroyApp = async () => {
		if (!l2dInstance.value) return
		await logger.info("销毁 Live2D 实例")
		if (typeof (l2dInstance.value as any).destroy === "function") {
			(l2dInstance.value as any).destroy()
		}
		// 清理 ResizeObserver
		resizeObserver?.disconnect()
		resizeObserver = null
		// 解绑自定义触摸检测
		teardownCustomTouchDetection()
		// 清理 hit area 覆盖层
		clearHitAreaOverlay()
		showHitAreas.value = false
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

		// 可触摸区域显示状态
		showHitAreas,

		// 已安装模型入口文件映射
		modelEntryFiles,
		refreshInstalled,

		// 核心方法
		initApp,
		loadModel,
		reloadModel,
		mountCanvas,
		detachCanvas,
		destroyApp,
		clearError,

		// 渲染控制方法
		setModelScale,
		setModelPosition,
		setShowHitAreas,
	}
})
