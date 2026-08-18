<script setup lang="ts">
import {onMounted} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {useRouter} from "vue-router"
import {logger} from "./services/logger"
import {useLive2DStore} from "./services/store/live2d.ts"

const ROUTER = useRouter()

const L2D = useLive2DStore()

// 配置键名
const CONFIG_KEY_MODEL = "selected_model"

onMounted(async () => {
	await logger.info("应用启动")
	if (await invoke("is_first_run")) {
		await logger.info("首次运行应用")
		await ROUTER.push({name: "FirstRun"})
		return
	}
	// 从数据库读取已保存的模型
	try {
		const SAVED = await invoke<string | null>("get_config", {key: CONFIG_KEY_MODEL})
		if (SAVED) {
			await L2D.initModel(SAVED)
		}
	} catch (error) {
		await logger.error("初始化 Live2D 模型失败:", error)
	}
	await ROUTER.push({name: "Main"})
})
</script>

<template>
	<RouterView/>
</template>
