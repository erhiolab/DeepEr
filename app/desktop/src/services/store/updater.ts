import {computed, ref} from "vue"
import {defineStore} from "pinia"
import {getVersion} from "@tauri-apps/api/app"
import {check, type DownloadEvent} from "@tauri-apps/plugin-updater"
import {relaunch} from "@tauri-apps/plugin-process"
import {openUrl} from "@tauri-apps/plugin-opener"
import {logger} from "../logger"
import useLanguages from "../i18n/useLanguages.ts"

/**
 * 更新状态
 */
export type UpdateStatus =
	| "idle"        // 未检查
	| "checking"    // 检查中
	| "up-to-date"  // 已是最新
	| "updating"    // 正在下载安装
	| "updated"     // 更新完成, 等待重启
	| "failed"      // 更新失败, 可手动更新
	| "error"       // 检查出错

/**
 * 应用更新状态管理
 *
 * 对外状态:
 *   - status            更新流程状态 (UpdateStatus)
 *   - currentVersion    当前应用版本号
 *   - availableVersion  发现的新版本号 (无更新时为空)
 *   - hasUpdate         是否有可用更新
 *   - updateNotes       新版本更新说明
 *   - updateError       错误信息
 *   - downloadProgress  下载进度 (0-100, 未开始时为 null)
 *   - isBusy            是否正在检查/下载中 (用于禁用按钮)
 *
 * 对外方法:
 *   - init()            初始化, 拉取当前版本号 (应用启动时调用一次)
 *   - checkForUpdates() 检查更新, 有新版则自动下载安装
 *   - restartToApply()  重启应用使更新生效
 *   - openManualUpdate() 跳转 GitHub Releases 手动下载
 *   - reset()           重置回未检查状态
 */
export const useUpdaterStore = defineStore("updater", () => {
	// 界面文案 (随语言响应式)
	const I18N = computed(() => useLanguages().components.firstRun.about)

	// 更新流程状态
	const status = ref<UpdateStatus>("idle")

	// 当前应用版本号
	const currentVersion = ref("")

	// 发现的新版本号
	const availableVersion = ref("")

	// 新版本更新说明
	const updateNotes = ref("")

	// 错误信息
	const updateError = ref("")

	// 下载进度 0-100, 未开始为 null
	const downloadProgress = ref<number | null>(null)

	// 是否有可用更新 (发现新版本且尚未完成安装)
	const hasUpdate = computed(() => !!availableVersion.value && status.value !== "up-to-date")

	// 是否正在忙碌 (检查中或下载安装中), 用于防重复点击 / 禁用按钮
	const isBusy = computed(() => status.value === "checking" || status.value === "updating")

	// 新版本信息摘要 (如 "发现新版本 v0.2.0")
	const summary = computed(() => {
		if (status.value === "up-to-date" || !availableVersion.value) return ""
		return I18N.value.update.latestVersion.replace("{version}", availableVersion.value)
	})

	// GitHub Releases 手动下载地址
	const RELEASE_URL = "https://github.com/erhiolab/DeepEr/releases"

	/**
	 * 初始化: 拉取当前应用版本号. 应用启动时调用一次
	 */
	const init = async () => {
		try {
			currentVersion.value = await getVersion()
			await logger.debug(`当前应用版本: v${currentVersion.value}`)
		} catch (error) {
			await logger.error("获取当前版本号失败:", error)
		}
	}

	/**
	 * 检查更新. 发现新版本则自动下载并安装, 安装完成后需调用 `restartToApply` 重启生效.
	 * - 无新版本 → status = "up-to-date"
	 * - 检查阶段失败 → status = "error"
	 * - 下载安装阶段失败 → status = "failed" (可走 `openManualUpdate` 手动更新)
	 */
	const checkForUpdates = async () => {
		// 防止重复触发
		if (isBusy.value) return
		status.value = "checking"
		updateError.value = ""
		updateNotes.value = ""
		availableVersion.value = ""
		downloadProgress.value = null
		try {
			const update = await check()
			if (!update) {
				// 没有新版本
				status.value = "up-to-date"
				return
			}
			// 发现新版本
			availableVersion.value = update.version
			updateNotes.value = update.body || ""
			status.value = "updating"
			// 自动下载并安装
			await update.downloadAndInstall(onDownloadEvent)
			// 安装完成, 需要重启生效
			status.value = "updated"
		} catch (error) {
			// 检查或下载安装失败
			await logger.error("检查更新失败:", error)
			updateError.value = error instanceof Error ? error.message : String(error)
			// 区分阶段: 检查失败 vs 下载安装失败
			status.value = status.value === "checking" ? "error" : "failed"
		}
	}

	/**
	 * 静默检查更新 (应用启动时调用): 只检查是否有新版本, 不自动下载安装.
	 * - 无新版本 → status = "up-to-date"
	 * - 有新版本 → status = "idle" (保持等用户点按钮触发下载), 仅填充 availableVersion 供 UI 展示
	 * - 检查失败 → status = "idle" (不打扰用户, 仅记日志)
	 */
	const checkSilently = async () => {
		if (isBusy.value) return
		try {
			const update = await check()
			if (!update) {
				status.value = "up-to-date"
				return
			}
			// 发现新版本: 只记录版本信息, 不自动下载, 由用户点击按钮触发
			availableVersion.value = update.version
			updateNotes.value = update.body || ""
			status.value = "idle"
			await logger.info(`发现新版本 v${update.version}, 待用户确认更新`)
		} catch (error) {
			await logger.error("静默检查更新失败:", error)
			// 静默失败不改变状态, 避免启动时打扰
			status.value = "idle"
		}
	}

	/**
	 * 下载进度回调 (由 checkForUpdates 传入 downloadAndInstall)
	 */
	const onDownloadEvent = (event: DownloadEvent) => {
		if (event.event === "Started") {
			downloadProgress.value = 0
			logger.debug("开始下载更新")
		} else if (event.event === "Progress") {
			logger.debug(`更新下载中: 本次块 ${event.data.chunkLength} bytes`)
		} else if (event.event === "Finished") {
			downloadProgress.value = 100
			logger.debug("更新下载完成")
		}
	}

	/**
	 * 重启应用使更新生效
	 */
	const restartToApply = async () => {
		try {
			await relaunch()
		} catch (error) {
			await logger.error("重启应用失败:", error)
			updateError.value = I18N.value.update.restartFailed
			status.value = "failed"
		}
	}

	/**
	 * 跳转 GitHub Releases 手动下载
	 */
	const openManualUpdate = async () => {
		try {
			await openUrl(RELEASE_URL)
		} catch (error) {
			await logger.error("打开 GitHub Releases 失败:", error)
		}
	}

	/**
	 * 重置回未检查状态
	 */
	const reset = () => {
		status.value = "idle"
		availableVersion.value = ""
		updateNotes.value = ""
		updateError.value = ""
		downloadProgress.value = null
	}

	return {
		// 状态
		status,
		currentVersion,
		availableVersion,
		updateNotes,
		updateError,
		downloadProgress,
		// 派生状态
		hasUpdate,
		isBusy,
		summary,
		// 方法
		init,
		checkForUpdates,
		checkSilently,
		restartToApply,
		openManualUpdate,
		reset,
	}
})
