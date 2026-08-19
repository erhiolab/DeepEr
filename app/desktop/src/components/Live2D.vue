<script setup lang="ts">
import {computed, onMounted, onBeforeUnmount, ref} from "vue"
import {invoke} from "@tauri-apps/api/core"
import useLanguages from "../services/i18n/useLanguages.ts"
import {useLive2DStore} from "../services/store/live2d.ts"
import Icon from "./Icon.vue"

const I18N = computed(() => useLanguages().components.live2d)

const L2D = useLive2DStore()

const containerRef = ref<HTMLCanvasElement | null>(null)

const CONFIG_KEY_MODEL = "selected_model"

onMounted(async () => {
	if (!containerRef.value) return
	const MODEL = await invoke<string | null>("get_config", {key: CONFIG_KEY_MODEL})
	if (!MODEL) return
	const APP_READY = await L2D.initApp(containerRef.value)
	if (!APP_READY) return
	await L2D.initModel(MODEL)
})

onBeforeUnmount(async () => {
	await L2D.destroyApp()
})
</script>

<template>
	<div class="live2d">
		<div ref="containerRef" class="live2d-canvas"/>
		<div v-if="L2D.isLoading" class="live2d-loading">
			<Icon name="loading"/>
			{{ I18N.loading }}
		</div>
		<div v-else-if="L2D.error" class="live2d-error">{{ L2D.error }}</div>
		<div v-else-if="!L2D.isInitialized" class="live2d-empty">{{ I18N.empty }}</div>
	</div>
</template>

<style scoped lang="less">
.live2d {
	position: relative;
	padding: 1.2rem 0.8rem;
	width: 40rem;
	height: 100%;
	min-height: 30rem;
	display: flex;
	align-items: center;
	justify-content: center;
	border-left: 0.1rem solid var(--line-subtle);
	color: var(--text-muted);
	font-size: 1.2rem;
	overflow: hidden;

	.live2d-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.live2d-canvas :deep(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.live2d-loading {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 0.6rem;
	}

	.live2d-error {
		position: relative;
		z-index: 1;
		color: var(--danger);
	}

	.live2d-empty {
		position: relative;
		z-index: 1;
	}
}
</style>