import {createRouter, createWebHashHistory} from "vue-router"
import {setFirstRunWindow, setMainWindow} from "../window"
import {logger} from "../logger"
import FirstRunView from "../../views/FirstRunView.vue"
import MainView from "../../views/Main.vue"
import PetView from "../../views/PetView.vue"

const router = createRouter({
	history: createWebHashHistory(),
	routes: [
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

router.afterEach(async (to) => {
	switch (to.path) {
		case "/first-run":
			await setFirstRunWindow()
			break
		case "/main":
			await setMainWindow()
			break
		case "/pet":
			// await setPetWindow()
			break
	}
})

router.beforeEach(async (to, from) => {
	await logger.info(`切换路由: ${from.path?.toString() || "未定义"} -> ${to.path?.toString() || "未定义"}`)
	return true
})

export default router
