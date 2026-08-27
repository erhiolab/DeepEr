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
 * 最小化窗口
 */
export const minimizeWindow = async () => {
	await appWindow.minimize()
}

/**
 * 切换窗口最大化状态 (最大化与恢复原大小之间切换)
 * Windows 无边框窗口需 resizable=true 才能最大化, 故切换前先确保可调整大小.
 */
export const toggleMaximizeWindow = async () => {
	await appWindow.setResizable(true)
	if (await appWindow.isMaximized()) {
		await appWindow.unmaximize()
	} else {
		await appWindow.maximize()
	}
}

/**
 * 设置窗口是否在任务栏显示图标
 * @param skip 为 true 时隐藏任务栏图标, 为 false 时显示
 */
export const setSkipTaskbar = async (skip: boolean) => {
	await appWindow.setSkipTaskbar(skip)
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

// 复位进行中禁止持久化
let resetting = false

// 定位进行中禁止持久化
let positioning = false

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

// 将当前窗口位置/大小写入数据库
const writeWindowState = async (width: number, height: number, x: number, y: number) => {
	await config.set("pet_width", width)
	await config.set("pet_height", height)
	await config.set("pet_window_x", x)
	await config.set("pet_window_y", y)
}

/**
 * 将当前窗口位置/大小立即写入数据库
 *
 * 仅在明确的时机调用: 进入桌宠页时无记录写基线、关闭调整模式、退出穿透、卸载兜底.
 * 不做移动/缩放过程中的实时防抖落盘, 从根源避免启动定位的中间坐标被写库.
 */
export const persistWindowState = async () => {
	// 定位/复位期间禁止写库, 避免中间状态污染配置
	if (positioning || resetting) {
		return
	}
	const SIZE = await appWindow.outerSize()
	const POSITION = await appWindow.outerPosition()
	const SCALE_FACTOR = await appWindow.scaleFactor()
	// 物理像素 → 逻辑像素
	const LOGICAL_WIDTH = Math.round(SIZE.width / SCALE_FACTOR)
	const LOGICAL_HEIGHT = Math.round(SIZE.height / SCALE_FACTOR)
	const LOGICAL_X = Math.round(POSITION.x / SCALE_FACTOR)
	const LOGICAL_Y = Math.round(POSITION.y / SCALE_FACTOR)
	await writeWindowState(LOGICAL_WIDTH, LOGICAL_HEIGHT, LOGICAL_X, LOGICAL_Y)
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
	// 显示任务栏图标 (首次运行属于"其他页面")
	await appWindow.setSkipTaskbar(false)
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
	// 允许调整大小 (配合标题栏最大/最小化按钮)
	await appWindow.setResizable(true)
	// 显示任务栏图标 (主界面属于"其他页面")
	await appWindow.setSkipTaskbar(false)
	// 居中窗口, 避免在角落打开主界面
	await appWindow.center()
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}

/**
 * 设置窗口属性为桌宠窗口
 *
 * @returns 是否恢复到了库中已有的桌宠位置/大小 (true 表示已按保存状态定位,
 *          false 表示首次运行或复位后, 窗口保持默认/居中的当前状态)
 */
export const setPetWindow = async (): Promise<boolean> => {
	// 定位期间标记, 抑制 onMoved/onResized 与后续写库, 防止中间状态污染配置
	positioning = true
	try {
		const SAVED = await getSavedPetState()
		const HAS_POS = SAVED.x != null && SAVED.y != null
		// 恢复上次保存的窗口大小, 无记录时用默认 300x300
		const WIDTH = SAVED.width ?? 300
		const HEIGHT = SAVED.height ?? 300
		// 先设大小, 再设位置: 确保定位在尺寸稳定之后执行, 避免中间坐标被读走
		await appWindow.setSize(new LogicalSize(WIDTH, HEIGHT))
		// 恢复上次保存的窗口位置, 无记录时不移动(保持当前)
		if (SAVED.x != null && SAVED.y != null) {
			await appWindow.setPosition(new LogicalPosition(SAVED.x, SAVED.y))
		}
		// 不允许调整大小
		await appWindow.setResizable(false)
		// 窗口置顶
		await appWindow.setAlwaysOnTop(true)
		// 桌宠页面隐藏任务栏图标
		await appWindow.setSkipTaskbar(true)
		// 显示窗口
		await appWindow.show()
		// 获取焦点
		await appWindow.setFocus()
		return HAS_POS
	} finally {
		positioning = false
	}
}

/**
 * 复位桌宠窗口: 居中显示窗口, 并重置数据库里的桌宠位置/大小记录
 *
 * 由托盘菜单"复位"触发. 复位期间的移动/缩放不写回数据库,
 * 且删除 pet_window_x/y/pet_width/pet_height, 使下次进入桌宠恢复默认大小与居中.
 */
export const resetPetWindow = async (): Promise<void> => {
	// 复位期间标记, 抑制定位/移动期间的持久化
	resetting = true
	try {
		// 恢复鼠标交互
		await restoreCursor()
		// 恢复默认桌宠大小 300x300
		await appWindow.setSize(new LogicalSize(300, 300))
		// 不允许调整大小
		await appWindow.setResizable(false)
		// 窗口置顶
		await appWindow.setAlwaysOnTop(true)
		// 桌宠页面隐藏任务栏图标
		await appWindow.setSkipTaskbar(true)
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
