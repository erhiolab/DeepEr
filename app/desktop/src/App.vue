<script setup lang="ts">
import {onMounted} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {useRouter} from "vue-router"
import {logger} from "./services/logger"
import UnsavedGuardDialog from "./components/common/UnsavedGuardDialog.vue"

const ROUTER = useRouter()

onMounted(async () => {
	await logger.info("应用启动")
	if (await invoke("is_first_run")) {
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
