<script setup lang="ts">
// PetView: 桌宠独立页面
// Live2D 已在 Main 页面初始化，这里只需复用全局 canvas
// 路由切换时，Live2D 组件的 onMounted 会自动将 canvas 挂载到新容器
import Live2D from "../components/Live2D.vue"
</script>

<template>
	<div class="pet-stage">
		<!-- 直接复用 Live2D 组件，它会自动挂载已有的全局 canvas -->
		<Live2D />
	</div>
</template>

<style scoped lang="less">
.pet-stage {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	background: transparent;
	cursor: pointer;
	user-select: none;
}
</style>
