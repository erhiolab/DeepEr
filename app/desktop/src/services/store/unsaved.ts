import {ref, shallowRef} from "vue"
import {defineStore} from "pinia"

/**
 * 离开守卫: 由可能产生未保存修改的页面组件注册 (同一时刻至多一个活跃).
 * 路由切换 / 页面内部导航离开前, 经 useUnsavedGuard().requestLeave() 统一询问,
 * 用户确认后再真正离开, 弹窗始终显示在离开前的页面上.
 */
export interface LeaveGuard {
	// 当前是否存在未保存修改
	hasUnsaved: () => boolean
	// 保存修改, 返回是否保存成功 (失败则留在当前页)
	onSave: () => Promise<boolean> | boolean
	// 放弃修改 (可选, 通常用于回滚预览到进入时的状态)
	onDiscard?: () => void
	// 弹窗文案
	title: string
	message: string
	saveLabel: string
	discardLabel: string
}

/**
 * 未保存修改守卫
 * 供任意组件在「即将卸载/离开」时弹一个全局确认框 (渲染在 App.vue 根部, 不随组件卸载).
 * 典型场景: TTS 配置页有未保存修改时用户切换到其它标签, 询问保存还是放弃.
 */
export const useUnsavedGuard = defineStore("unsaved-guard", () => {
	// 打开状态, 用于判断是否弹出确认框
	const open = ref(false)

	// 弹框标题
	const title = ref("")

	// 弹框内容
	const message = ref("")

	// 危险按钮文本
	const dangerLabel = ref("")

	// 主按钮文本
	const primaryLabel = ref("")

	// 回调存入 store 内部的普通闭包 (不参与响应式, 组件卸载后仍能在点击时触发)
	let onSave: (() => void) | null = null
	let onDiscard: (() => void) | null = null

	// 当前注册的离开守卫
	const leaveGuard = shallowRef<LeaveGuard | null>(null)

	/**
	 * 注册离开守卫 (页面组件挂载时调用)
	 */
	const register = (guard: LeaveGuard) => {
		leaveGuard.value = guard
	}

	/**
	 * 注销离开守卫 (页面组件卸载时调用)
	 */
	const unregister = () => {
		leaveGuard.value = null
	}

	// requestLeave 挂起中待 resolve 的回调 (仅用于「用户取消」时返回 false)
	let pendingResolve: ((ok: boolean) => void) | null = null

	// 统一弹窗字段赋值
	const openDialog = (opts: {
		title: string
		message: string
		saveLabel: string
		discardLabel: string
		onSave: () => void
		onDiscard?: () => void
	}) => {
		title.value = opts.title
		message.value = opts.message
		primaryLabel.value = opts.saveLabel
		dangerLabel.value = opts.discardLabel
		onSave = opts.onSave
		onDiscard = opts.onDiscard ?? null
		open.value = true
	}

	/**
	 * 请求离开当前页面:
	 * - 无未保存修改 → 立即放行
	 * - 有未保存修改 → 弹全局确认框, 由用户选择「保存 / 放弃 / 取消」
	 * @returns true = 可以离开; false = 用户取消 (留在当前页)
	 */
	const requestLeave = (): Promise<boolean> => {
		const GUARD = leaveGuard.value
		if (!GUARD || !GUARD.hasUnsaved()) return Promise.resolve(true)
		return new Promise<boolean>((resolve) => {
			pendingResolve = resolve
			openDialog({
				title: GUARD.title,
				message: GUARD.message,
				saveLabel: GUARD.saveLabel,
				discardLabel: GUARD.discardLabel,
				onSave: async () => {
					const OK = await GUARD.onSave()
					pendingResolve = null
					close()
					resolve(OK)
				},
				onDiscard: () => {
					GUARD.onDiscard?.()
					pendingResolve = null
					close()
					resolve(true)
				},
			})
		})
	}

	/**
	 * 弹出询问框, 一旦弹出, 由对话框按钮回调决定后续
	 * @param opts
	 */
	const ask = (opts: {
		title: string
		message: string
		saveLabel: string
		discardLabel: string
		onSave: () => void
		onDiscard?: () => void
	}) => {
		openDialog(opts)
	}

	/**
	 * 关闭确认框 (仅收起弹窗, 不触发任何回调)
	 */
	const close = () => {
		open.value = false
		onSave = null
		onDiscard = null
	}

	/**
	 * 取消当前询问 (点 ✕ / 遮罩): 若正在等待离开确认, 视为「取消离开」
	 */
	const cancel = () => {
		const RESOLVE = pendingResolve
		pendingResolve = null
		close()
		RESOLVE?.(false)
	}

	/**
	 * 确认保存
	 */
	const save = () => {
		const cb = onSave
		close()
		cb?.()
	}

	/**
	 * 确认放弃
	 */
	const discard = () => {
		const cb = onDiscard
		close()
		cb?.()
	}

	return {open, title, message, dangerLabel, primaryLabel, leaveGuard, register, unregister, requestLeave, ask, close, cancel, save, discard}
})
