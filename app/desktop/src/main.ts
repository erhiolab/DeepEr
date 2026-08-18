import {createApp} from "vue"
import {createPinia} from "pinia"
import App from "./App.vue"
import router from "./services/router"
import useLanguage, {i18n} from "./services/i18n"
import "./assets/style/theme.less"

const APP = createApp(App)
const PINIA = createPinia()

await useLanguage.init()

APP.use(router)
APP.use(i18n)
APP.use(PINIA)

APP.mount("#app")
