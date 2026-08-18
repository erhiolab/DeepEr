<script setup lang="ts">
import {computed} from "vue"
import useLanguages from "../services/i18n/useLanguages"

// 窗口通用标题栏
defineSlots<{
	default: () => unknown
}>()

const I18N = computed(() => useLanguages().components.titleBar)
</script>

<template>
	<div class="titlebar" data-tauri-drag-region>
		<span class="title" data-tauri-drag-region>{{ I18N.title }}</span>
		<slot/>
	</div>
</template>

<style scoped lang="less">
.titlebar {
	height: 4.4rem;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 1.2rem 0 1.6rem;
	flex-shrink: 0;

	.title {
		color: var(--text-primary);
		font-size: 1.3rem;
		font-weight: 600;
		letter-spacing: 0.05rem;
	}
}
</style>
