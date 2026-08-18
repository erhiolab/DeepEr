import {getCurrentWindow, LogicalSize} from "@tauri-apps/api/window"

const appWindow = getCurrentWindow()

/**
 * 隐藏窗口
 */
export const hideWindow = async () => {
	await appWindow.hide()
}

/**
 * 显示窗口
 */
export const showWindow = async () => {
	await appWindow.show()
}

/**
 * 关闭窗口
 */
export const closeWindow = async () => {
	await appWindow.close()
}

/**
 * 设置窗口属性为首次运行
 */
export const setFirstRunWindow = async () => {
	// 设置窗口大小
	await appWindow.setSize(new LogicalSize(720, 480))
	// 不置顶
	await appWindow.setAlwaysOnTop(false)
	// 不允许调整大小
	await appWindow.setResizable(false)
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}

/**
 * 设置窗口属性为主窗口
 */
export const setMainWindow = async () => {
	// 设置窗口大小
	await appWindow.setSize(new LogicalSize(1500, 750))
	// 不置顶
	await appWindow.setAlwaysOnTop(false)
	// 不允许调整大小
	await appWindow.setResizable(false)
	// 显示窗口
	await appWindow.show()
	// 获取焦点
	await appWindow.setFocus()
}