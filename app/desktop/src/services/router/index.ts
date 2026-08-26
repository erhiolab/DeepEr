import {createRouter, createWebHashHistory} from "vue-router"
import {emit} from "@tauri-apps/api/event"
import {setFirstRunWindow, setMainWindow} from "../window"
import {logger} from "../logger"
import {useUnsavedGuard} from "../store/unsaved"
import FirstRunView from "../../views/FirstRunView.vue"
import MainView from "../../views/Main.vue"
import PetView from "../../views/PetView.vue"

const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{
			path: "/",
			redirect: "/first-run"
		},
		{
			path: "/first-run",
			name: "FirstRun",
			component: FirstRunView
		},
		{
			path: "/main",
			name: "Main",
			component: MainView
		},
		{
			path: "/pet",
			name: "Pet",
			component: PetView
		}
	]
})

router.afterEach(async (to, _from, failure) => {
	if (failure) return
	void emit("tray-set-view", to.name === "Main")
	switch (to.name) {
		case "FirstRun":
			await setFirstRunWindow()
			break
		case "Main":
			await setMainWindow()
			break
		case "Pet":
			break
	}
})

router.beforeEach(async (to, from) => {
	await logger.info(`切换路由: ${from.path?.toString() || "未定义"} -> ${to.path?.toString() || "未定义"}`)
	if (!(await useUnsavedGuard().requestLeave())) {
		return false
	}
	return true
})

export default router
