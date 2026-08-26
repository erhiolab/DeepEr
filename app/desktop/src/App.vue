<script setup lang="ts">
import {onMounted} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {useRouter} from "vue-router"
import {logger} from "./services/logger"
import {useUpdaterStore} from "./services/store/updater.ts"
import UnsavedGuardDialog from "./components/common/UnsavedGuardDialog.vue"

const ROUTER = useRouter()
const updater = useUpdaterStore()

onMounted(async () => {
	await logger.info("应用启动")
	void updater.init()
	if (await invoke("is_first_run")) {
		await logger.info("首次运行应用")
		await ROUTER.push({name: "FirstRun"})
		return
	}
	// 正常启动: 静默检查更新 (发现新版本只提示, 不自动下载)
	void updater.checkSilently()
	await ROUTER.push({name: "Pet"})
})
</script>

<template>
	<RouterView/>
	<UnsavedGuardDialog/>
</template>
