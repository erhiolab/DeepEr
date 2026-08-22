import {createApp} from "vue"
import {createPinia} from "pinia"
import {listen} from "@tauri-apps/api/event"
import App from "./App.vue"
import router from "./services/router"
import Vue3Toastify, {type ToastContainerOptions} from "vue3-toastify"
import useLanguage, {i18n} from "./services/i18n"
import "vue3-toastify/dist/index.css"
import "./assets/style/theme.less"

const APP = createApp(App)
const PINIA = createPinia()

await useLanguage.init()

APP.use(router)
APP.use(i18n)
APP.use(PINIA)
APP.use(Vue3Toastify, {
	theme: "dark",
	position: "top-center",
	limit: 3,
	autoClose: 2000
} as ToastContainerOptions)

// 托盘导航事件: 跳转到主界面或桌宠
void listen("tray-navigate", (event) => {
	const TARGET = event.payload as string
	if (TARGET === "pet") {
		void router.push({name: "Pet"})
	} else {
		void router.push({name: "Main"})
	}
})

// 托盘"取消穿透": 恢复窗口鼠标交互 (穿透后窗口点不到, 由托盘恢复)
void import("./services/window").then(({restoreCursor}) => {
	void listen("tray-cancel-passthrough", () => {
		void restoreCursor()
	})
})

// 托盘"复位": 跳到桌宠视图, 居中显示窗口, 并重置数据库中的桌宠位置/大小记录
void import("./services/window").then(({resetPetWindow}) => {
	void listen("tray-reset", () => {
		void router.push({name: "Pet"})
		void resetPetWindow()
	})
})

APP.mount("#app")

// 禁用 WebView 默认右键菜单 (含其中的"检查"入口)
window.addEventListener("contextmenu", (e) => {
	e.preventDefault()
})

// 禁用 Ctrl+滚轮 页面临时缩放 (同时消除缩放时的百分比浮层)
// 以及 Ctrl+加号/减号/0 的缩放快捷键
window.addEventListener("wheel", (e) => {
	if (e.ctrlKey) e.preventDefault()
}, {passive: false})

window.addEventListener("keydown", (e) => {
	if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault()
})
