import {getCurrentWindow, LogicalSize, LogicalPosition} from "@tauri-apps/api/window"
import {emit} from "@tauri-apps/api/event"
import {config} from "../config"

const appWindow = getCurrentWindow()

/**
 * 窗口调整大小方向 (四角对角 + 四边单向)
 */
export type ResizeDirection =
	| "NorthWest"
	| "NorthEast"
	| "SouthWest"
	| "SouthEast"
	| "North"
	| "South"
	| "West"
	| "East"

/**
 * 隐藏窗口
 */
export const hideWindow = async () => {
	await appWindow.hide()
}

/**
 * 开始拖动窗口 (移动窗口)
 */
export const startDragWindow = async () => {
	await appWindow.startDragging()
}

/**
 * 开始调整窗口大小 (方向, 由系统原生接管拖拽)
 * @param direction 调整方向, 由窗口四角及四边控制点触发
 */
export const startResizeWindow = async (direction: ResizeDirection) => {
	await appWindow.startResizeDragging(direction)
}

/**
 * 关闭窗口
 */
export const closeWindow = async () => {
	await appWindow.close()
}

/**
 * 设置可调节窗口大小
 */
export const setResizableWindow = async () => {
	await appWindow.setResizable(true)
}

/**
 * 设置窗口属性为不可调节大小
 */
export const setUnresizableWindow = async () => {
	await appWindow.setResizable(false)
}

/**
 * 开启点击穿透
 */
export const setPassthrough = async () => {
	await appWindow.setIgnoreCursorEvents(true)
}

/**
 * 恢复鼠标交互
 */
export const restoreCursor = async () => {
	await appWindow.setIgnoreCursorEvents(false)
}

// 防抖定时器
let persistTimer: ReturnType<typeof setTimeout> | null = null

// 复位进行中禁止持久化 (复位会移动/缩放窗口, 触发 onMoved/onResized 会误写回数据库)
let resetting = false

/**
 * 读取上次保存的桌宠窗口位置/大小
 */
const getSavedPetState = async () => {
	const [x, y, width, height] = await Promise.all([
		config.get("pet_window_x"),
		config.get("pet_window_y"),
		config.get("pet_width"),
		config.get("pet_height")
	])
	return {
		x: x != null ? Number(x) : null,
		y: y != null ? Number(y) : null,
		width: width != null ? Number(width) : null,
		height: height != null ? Number(height) : null
	}
}

/**
 * 将当前窗口位置/大小防抖写入数据库
 */
// 实际写入窗口状态到数据库
const writeWindowState =  async (width: number, height: number, x: number, y: number) => {
	await config.set("pet_width", width)
	await config.set("pet_height", height)
	await config.set("pet_window_x", x)
	await config.set("pet_window_y", y)
}

/**
 * 将当前窗口位置/大小写入数据库 (可选用防抖延迟)
 * @param delay 防抖毫秒数, 传 0 或负数则立即写入
 */
export const persistWindowState = async (delay = 500) => {
	const SIZE = await appWindow.outerSize()
	const POSITION = await appWindow.outerPosition()
	const SCALE_FACTOR = await appWindow.scaleFactor()
	// 物理像素 → 逻辑像素
	const LOGICAL_WIDTH = Math.round(SIZE.width / SCALE_FACTOR)
	const LOGICAL_HEIGHT = Math.round(SIZE.height / SCALE_FACTOR)
	const LOGICAL_X = Math.round(POSITION.x / SCALE_FACTOR)
	const LOGICAL_Y = Math.round(POSITION.y / SCALE_FACTOR)
	if (persistTimer) {
		clearTimeout(persistTimer)
		persistTimer = null
	}
	// 立即写入场景 (移动/缩放结束, 卸载, 进入桌宠)
	if (delay <= 0) {
		await writeWindowState(LOGICAL_WIDTH, LOGICAL_HEIGHT, LOGICAL_X, LOGICAL_Y)
		return
	}
	// 防抖写入 (移动/缩放进行中, 停止后上次值落库)
	persistTimer = setTimeout(() => {
		persistTimer = null
		writeWindowState(LOGICAL_WIDTH, LOGICAL_HEIGHT, LOGICAL_X, LOGICAL_Y)
	}, delay)
}

/**
 * 注册窗口移动/缩放监听, 结束操作后防抖保存窗口状态 (大小 + 位置)
 * 需要返回注销函数
 */
export const watchWindowState = async (): Promise<() => void> => {
	const STOPS: (() => void)[] = []
	STOPS.push(await appWindow.onMoved(() => {
		if (resetting) return
		void persistWindowState()
	}))
	STOPS.push(await appWindow.onResized(() => {
		if (resetting) return
		void persistWindowState()
	}))
	return () => {
		for (const stop of STOPS) stop()
		if (persistTimer) clearTimeout(persistTimer)
	}
}

/**
 * 设置窗口属性为首次运行
 */
export const setFirstRunWindow = async () => {
	// 恢复鼠标交互
	await restoreCursor()
	// 设置窗口大小
	await appWindow.setSize(new LogicalSize(720, 480))
	// 不置顶
	await appWindow.setAlwaysOnTop(false)
	// 不允许调整大小
	await appWindow.setResizable(false)
	// 居中窗口
	await appWindow.center()
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}

/**
 * 设置窗口属性为主窗口
 */
export const setMainWindow = async () => {
	// 恢复鼠标交互
	await restoreCursor()
	// 设置窗口大小
	await appWindow.setSize(new LogicalSize(1300, 750))
	// 不置顶
	await appWindow.setAlwaysOnTop(false)
	// 不允许调整大小
	await appWindow.setResizable(false)
	// 居中窗口, 避免在角落打开主界面
	await appWindow.center()
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}

/**
 * 设置窗口属性为桌宠窗口
 */
export const setPetWindow = async () => {
	const SAVED = await getSavedPetState()
	// 恢复上次保存的窗口大小, 无记录时用默认 300x300
	const WIDTH = SAVED.width ?? 300
	const HEIGHT = SAVED.height ?? 300
	await appWindow.setSize(new LogicalSize(WIDTH, HEIGHT))
	// 恢复上次保存的窗口位置, 无记录时不移动(保持当前)
	if (SAVED.x != null && SAVED.y != null) {
		await appWindow.setPosition(new LogicalPosition(SAVED.x, SAVED.y))
	}
	// 不允许调整大小
	await appWindow.setResizable(false)
	// 窗口置顶
	await appWindow.setAlwaysOnTop(true)
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}

/**
 * 复位桌宠窗口: 居中显示窗口, 并重置数据库里的桌宠位置/大小记录
 *
 * 由托盘菜单"复位"触发. 复位期间的移动/缩放不写回数据库,
 * 且删除 pet_window_x/y/pet_width/pet_height, 使下次进入桌宠恢复默认大小与居中.
 */
export const resetPetWindow = async (): Promise<void> => {
	// 复位期间标记, 抑制 onMoved/onResized 的自动持久化
	resetting = true
	try {
		// 清除可能挂起的防抖写库
		if (persistTimer) {
			clearTimeout(persistTimer)
			persistTimer = null
		}
		// 恢复鼠标交互
		await restoreCursor()
		// 恢复默认桌宠大小 300x300
		await appWindow.setSize(new LogicalSize(300, 300))
		// 不允许调整大小
		await appWindow.setResizable(false)
		// 窗口置顶
		await appWindow.setAlwaysOnTop(true)
		// 居中显示窗口
		await appWindow.center()
		// 显示窗口并获取焦点
		await appWindow.show()
		await appWindow.setFocus()
		// 重置数据库中的桌宠位置/大小记录 (下次进入桌宠时恢复默认并居中)
		await config.delete("pet_window_x")
		await config.delete("pet_window_y")
		await config.delete("pet_width")
		await config.delete("pet_height")
	} finally {
		resetting = false
	}
	// 通知后端复位已完成, 重新启用托盘"复位"菜单项
	await emit("tray-reset-done")
}
