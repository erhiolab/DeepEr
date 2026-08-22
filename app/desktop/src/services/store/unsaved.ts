import {ref} from "vue"
import {defineStore} from "pinia"

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
		title.value = opts.title
		message.value = opts.message
		primaryLabel.value = opts.saveLabel
		dangerLabel.value = opts.discardLabel
		onSave = opts.onSave
		onDiscard = opts.onDiscard ?? null
		open.value = true
	}

	/**
	 * 关闭确认框
	 */
	const close = () => {
		open.value = false
		onSave = null
		onDiscard = null
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

	return {open, title, message, dangerLabel, primaryLabel, ask, close, save, discard}
})
