import {computed, ref} from "vue"
import {defineStore} from "pinia"
import {invoke} from "@tauri-apps/api/core"
import {emit} from "@tauri-apps/api/event"
import {logger} from "../logger"
import useLanguages from "../i18n/useLanguages.ts"

/**
 * 触摸区域类型
 */
export type TouchType = "tap" | "swipe" | "frenzy"

/**
 * 触摸区域配置
 */
export interface TouchArea {
	id: string
	name: string
	type: TouchType
	x: number
	y: number
	w: number
	h: number
	image: string
	prompt: string
}

/**
 * 模型渲染配置
 */
export interface ModelRenderConfig {
	scale: number
	posX: number
	posY: number
}

/**
 * 模型触摸配置
 */
export interface ModelTouchConfig {
	version: number
	render: ModelRenderConfig
	touches: TouchArea[]
}

/**
 * 点击阈值
 * 小于该位移视为点击 (逻辑像素)
 */
export const TAP_MAX_DISTANCE = 12

/**
 * 磨蹭阈值
 * 累计移动超过该距离视为磨蹭
 */
export const SWIPE_MIN_DISTANCE = 60

/**
 * 点击狂点阈值
 * 窗口期内最少点击次数
 */
export const FRENZY_MIN_CLICKS = 3

/**
 * 点击狂点阈值
 * 窗口期时间窗口 (毫秒)
 */
export const FRENZY_WINDOW_MS = 1200

// 默认触摸配置
const defaultConfig = (): ModelTouchConfig => ({
	version: 1,
	render: {scale: 1.0, posX: 0.0, posY: 0.0},
	touches: [],
})

const uid = () => `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * 模型触摸配置 store
 * 每个模型在模型目录下维护一份 `model.config.json`, 数据库不再保存模型渲染信息
 */
export const useTouchStore = defineStore("touch", () => {
	// 界面文案 (随语言响应式)
	const I18N = computed(() => useLanguages().components.live2d)

	// 是否已加载
	const loaded = ref(false)

	// 当前模型名
	const modelName = ref<string | null>(null)

	// 当前模型配置
	const config = ref<ModelTouchConfig>(defaultConfig())

	// 当前模型触摸区域
	const touches = computed(() => config.value.touches)

	// 当前模型渲染配置
	const render = computed(() => config.value.render)

	/**
	 * 读取模型的触摸配置, 缺失回落默认
	 */
	const load = async (name: string): Promise<void> => {
		try {
			const DATA = await invoke<ModelTouchConfig>("read_model_config", {name})
			config.value = {
				...defaultConfig(),
				...DATA,
				render: {...defaultConfig().render, ...DATA?.render},
				touches: Array.isArray(DATA?.touches) ? DATA.touches : [],
			}
			modelName.value = name
			loaded.value = true
			await logger.info(`已加载模型触摸配置: ${name}, touches=${config.value.touches.length}`)
		} catch (err) {
			await logger.error(`读取模型触摸配置失败: ${name}`, err)
		}
	}

	/**
	 * 写回当前配置
	 */
	const save = async (): Promise<boolean> => {
		if (!modelName.value) return false
		try {
			await invoke("write_model_config", {name: modelName.value, config: config.value})
			await logger.info(`已保存模型触摸配置: ${modelName.value}`)
			return true
		} catch (err) {
			await logger.error("保存模型触摸配置失败:", err)
			return false
		}
	}


	/**
	 * 添加一个触摸区域
	 * @param data 触摸区域配置
	 */
	const addTouch = async (data: Omit<TouchArea, "id" | "image" | "prompt">) => {
		config.value.touches.push({
			...data,
			id: uid(),
			image: "",
			prompt: "",
		})
		await save()
	}

	/**
	 * 更新一个触摸区域
	 * @param id 触摸区域 ID
	 * @param patch 更新字段
	 */
	const updateTouch = async (id: string, patch: Partial<TouchArea>) => {
		config.value.touches = config.value.touches.map((t) =>
			t.id === id ? {...t, ...patch} : t,
		)
		await save()
	}

	/**
	 * 拖动中实时更新某个触摸区域的位置/尺寸 (仅改内存, 不落盘)
	 * 松手后再调用 `save` / `updateTouch` 持久化, 避免拖动过程中反复写盘
	 */
	const moveTouch = (id: string, patch: Partial<Pick<TouchArea, "x" | "y">>) => {
		config.value.touches = config.value.touches.map((t) => {
			if (t.id !== id) return t
			const next = {
				...t,
				...patch,
			}
			// 数值防御: 越界/非有限数兜底到合理值, 避免把区域"画没"
			const fin = (v: number, d: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
			next.x = fin(next.x, t.x)
			next.y = fin(next.y, t.y)
			return next
		})
	}

	/**
	 * 删除一个触摸区域
	 * @param id 触摸区域 ID
	 */
	const removeTouch = async (id: string) => {
		config.value.touches = config.value.touches.filter((t) => t.id !== id)
		await save()
	}

	/**
	 * 更新模型渲染配置
	 * @param patch 更新字段
	 */
	const setRender = async (patch: Partial<ModelRenderConfig>) => {
		config.value.render = {...config.value.render, ...patch}
		await save()
	}

	/**
	 * 触发一个自定义触摸回调
	 * 当前派发 `touch-triggered` 事件 + 日志, 未来接入 LLM 上下文
	 */
	const trigger = async (touch: TouchArea) => {
		// 按触摸类型取本地化描述
		const TYPED_PROMPT =
			touch.type === "swipe"
				? I18N.value.touchedSwipe(touch.name)
				: touch.type === "frenzy"
					? I18N.value.touchedFrenzy(touch.name)
					: I18N.value.touchedName(touch.name)
		const PAYLOAD = {
			modelName: modelName.value,
			touchName: touch.name,
			touchType: touch.type,
			touchPrompt: touch.prompt || TYPED_PROMPT,
			touchId: touch.id,
		}
		await logger.info(`[touch] 触发: ${JSON.stringify(PAYLOAD)}`)
		console.log(`[touch] 触发: ${JSON.stringify(PAYLOAD)}`)
		void emit("touch-triggered", PAYLOAD)
	}

	return {
		loaded,
		modelName,
		config,
		touches,
		render,
		load,
		save,
		addTouch,
		updateTouch,
		moveTouch,
		removeTouch,
		setRender,
		trigger,
	}
})
