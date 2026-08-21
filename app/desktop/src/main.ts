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

APP.mount("#app")
