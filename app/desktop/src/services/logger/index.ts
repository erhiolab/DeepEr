import {invoke} from "@tauri-apps/api/core"

type LogType = "debug" | "info" | "warn" | "error"

// 格式化错误信息
const formatError = (error: unknown): string => {
	if (error instanceof Error) {
		return error.stack ? `${error.name}: ${error.message}\n${error.stack}` : `${error.name}: ${error.message}`
	}
	if (typeof error === "string") {
		return error
	}
	try {
		return JSON.stringify(error)
	} catch {
		return String(error)
	}
}

// 写入日志
const writeLog = async (type: LogType, msg: string, error?: unknown) => {
	let message = msg
	if (error !== undefined) message += `\n错误信息: ${formatError(error)}`
	try {
		await invoke("write_log", {level: type, message})
	} catch (invokeError) {
		console[type](msg, error)
		console.error("写入日志失败", invokeError)
	}
}

/**
 * 日志记录器
 */
export const logger = {
	debug: (msg: string, error?: unknown) => writeLog("debug", msg, error),
	info: (msg: string, error?: unknown) => writeLog("info", msg, error),
	warn: (msg: string, error?: unknown) => writeLog("warn", msg, error),
	error: (msg: string, error?: unknown) => writeLog("error", msg, error),
}

