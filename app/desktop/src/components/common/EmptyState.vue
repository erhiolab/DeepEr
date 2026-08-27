<script setup lang="ts">
/**
 * 通用空状态: 图标 + 标题 + 提示 (可放插槽内容)
 */
import Icon from "./Icon.vue"
import type {IconName} from "../../services/icon"

withDefaults(defineProps<{
	icon?: IconName
	title?: string
	hint?: string
}>(), {
	icon: "info",
})

defineSlots<{
	default?: () => unknown
}>()
</script>

<template>
	<div class="empty-state">
		<Icon :name="icon" :size="34" class="empty-icon"/>
		<span v-if="title" class="empty-title">{{ title }}</span>
		<span v-if="hint" class="empty-hint">{{ hint }}</span>
		<slot/>
	</div>
</template>

<style scoped lang="less">
.empty-state {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	padding: 1.5rem;
	text-align: center;

	.empty-icon {
		color: var(--deep-teal-soft);
		opacity: 0.7;
	}

	.empty-title {
		font-size: 1.3rem;
		font-weight: 600;
		color: var(--text-body);
	}

	.empty-hint {
		font-size: 1rem;
		color: var(--text-muted);
	}
}
</style>
