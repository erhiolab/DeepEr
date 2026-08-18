<script setup lang="ts">
import {onBeforeUnmount} from "vue"
import {setAngle} from "live2d-easy-control"
import {useLive2DStore} from "../services/store/live2d.ts"

const L2D = useLive2DStore()

const onMouseMove = (e: MouseEvent) => {
	setAngle(e).catch(() => {
		/* 未加载完成时忽略 */
	})
}

onBeforeUnmount(() => {
	void L2D.destroyModel()
})
</script>

<template>
	<div class="pet-stage" @mousemove="onMouseMove">
		<canvas ref="canvasRef" class="pet-canvas"/>
	</div>
</template>

<style scoped lang="less">
.pet-stage {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: visible;
	background: transparent;
	cursor: pointer;
	user-select: none;
}

.pet-canvas {
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	display: block;
}
</style>
