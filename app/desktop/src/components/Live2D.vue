<script setup lang="ts">
import {computed, onMounted, onBeforeUnmount, ref} from "vue"
import useLanguages from "../services/i18n/useLanguages.ts"
import {config} from "../services/config"
import {useLive2DStore} from "../services/store/live2d.ts"
import Icon from "./Icon.vue"

const I18N = computed(() => useLanguages().components.live2d)

const L2D = useLive2DStore()

// 容器引用
const containerRef = ref<HTMLDivElement | null>(null)

onMounted(async () => {
	if (!containerRef.value) return
	if (!L2D.l2dInstance) {
		await L2D.initApp()
		const MODEL = await config.get("live2d_model")
		if (MODEL) await L2D.loadModel(MODEL)
	}
	await L2D.mountCanvas(containerRef.value)
})

onBeforeUnmount(() => {
	if (containerRef.value) L2D.detachCanvas(containerRef.value)
})
</script>

<template>
	<div class="live2d-container">
		<div ref="containerRef" class="live2d-canvas-target"></div>
		<div v-if="L2D.isLoading" class="live2d-overlay live2d-loading">
			<Icon name="loading" class="animate-spin"/>
			<p>
				<span>{{ I18N.loading }}</span>
				<span v-if="L2D.totalFiles > 0" class="text-sm">({{ L2D.loadedFiles }} / {{ L2D.totalFiles }})</span>
			</p>
			<p v-if="L2D.isRetrying" class="text-sm live2d-retrying">{{ I18N.retrying(L2D.retryCount, L2D.retryTotal) }}</p>
		</div>
		<div v-else-if="L2D.error" class="live2d-overlay live2d-error">
			<Icon name="error"/>
			<span>{{ L2D.error }}</span>
		</div>
		<div v-else-if="L2D.l2dInstance && !L2D.isInitialized" class="live2d-overlay live2d-empty">
			<span>{{ I18N.empty }}</span>
		</div>
	</div>
</template>

<style scoped lang="less">
.live2d-container {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
}

.live2d-canvas-target {
	width: 100%;
	height: 100%;
	position: relative;
	z-index: 1;
}

.live2d-overlay {
	position: absolute;
	inset: 0;
	z-index: 10;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.8rem;
	// backdrop-filter: blur(4px);
	// background: rgba(0, 0, 0, 0.1);
}

.live2d-loading {
	color: var(--text-muted);
	font-size: 1.2rem;

	.text-sm {
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.live2d-retrying {
		color: var(--warning, #d97706);
	}
}

.live2d-error {
	color: var(--danger);
	font-size: 1.2rem;
	text-align: center;
	padding: 1rem;
}

.live2d-empty {
	color: var(--text-muted);
	font-size: 1.2rem;
}
</style>