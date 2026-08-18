<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import useLanguages from "../services/i18n/useLanguages.ts"
import {useLive2DStore} from "../services/store/live2d"
import Icon from "./Icon.vue"

const L2D = useLive2DStore()

const I18N = computed(() => useLanguages().components.live2d)

const containerRef = ref<HTMLDivElement>()

const bindCanvas = () => {
	const CONTAINER = containerRef.value
	const CANVAS = L2D.canvas
	if (!CONTAINER || !CANVAS) return

	if (CANVAS.parentElement !== CONTAINER) {
		CONTAINER.appendChild(CANVAS)
	}

	resizeCanvas()
}

const resizeCanvas = () => {
	const CONTAINER = containerRef.value
	const CANVAS = L2D.canvas
	if (!CONTAINER || !CANVAS) return

	const RECT = CONTAINER.getBoundingClientRect()
	const RATIO = window.devicePixelRatio || 1

	CANVAS.width = RECT.width * RATIO
	CANVAS.height = RECT.height * RATIO
}

let resizeObserver: ResizeObserver | null = null

watch(() => L2D.canvas, () => {
	bindCanvas()
})

onMounted(() => {
	bindCanvas()
	if (containerRef.value) {
		resizeObserver = new ResizeObserver(() => resizeCanvas())
		resizeObserver.observe(containerRef.value)
	}
})

onBeforeUnmount(() => {
	resizeObserver?.disconnect()
	resizeObserver = null
})
</script>

<template>
	<div ref="containerRef" class="live2d">
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
	min-height: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	border-left: 0.1rem solid var(--line-subtle);
	color: var(--text-muted);
	font-size: 1.2rem;
	overflow: hidden;

	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.live2d-loading {
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 0.6rem;
	}

	.live2d-error {
		color: var(--danger);
	}
}
</style>