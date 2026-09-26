import {invoke} from "@tauri-apps/api/core"
import {getCurrentWindow} from "@tauri-apps/api/window"

const showStartupFailure = async (error: unknown) => {
	const DETAILS = error instanceof Error ? error.stack || error.message : String(error)
	console.error("Failed to load the frontend", error)
	try {
		await invoke("write_log", {level: "error", message: `前端引导失败:\n${DETAILS}`})
	} catch (logError) {
		console.error("前端引导失败写入日志", logError)
	}
	document.body.innerHTML = `
		<main style="font-family:system-ui,sans-serif;padding:2rem;color:#e8eef6;background:#102235;min-height:100vh;box-sizing:border-box">
			<h1>DeepEr failed to start</h1>
			<p>The frontend resources could not be loaded. Error details were written to the application log.</p>
			<p style="color:#9fb3c8">%APPDATA%\\cn.erhio.deeper\\log\\frontend_YYYY-MM-DD.log</p>
		</main>
	`
	try {
		const window = getCurrentWindow()
		await window.show()
		await window.setFocus()
	} catch (windowError) {
		console.error("启动失败窗口显示失败", windowError)
	}
}

void import("./main").catch(showStartupFailure)
