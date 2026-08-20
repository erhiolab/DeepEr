import {createApp} from "vue"
import {createPinia} from "pinia"
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

APP.mount("#app")
