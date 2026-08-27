<script setup lang="ts">
import {onMounted} from "vue"
import {useRouter} from "vue-router"
import {logger} from "./services/logger"
import {useUpdaterStore} from "./services/store/updater.ts"
import UnsavedGuardDialog from "./components/common/UnsavedGuardDialog.vue"
import {config} from "./services/config"

const ROUTER = useRouter()
const updater = useUpdaterStore()

onMounted(async () => {
	await logger.info("应用启动")
	void updater.init()
	void updater.checkSilently()
	if (!(await config.get("first_run_completed") === "true")) {
		await logger.info("首次运行应用")
		await ROUTER.push({name: "FirstRun"})
		return
	}
	await ROUTER.push({name: "Pet"})
})
</script>

<template>
	<RouterView/>
	<UnsavedGuardDialog/>
</template>
