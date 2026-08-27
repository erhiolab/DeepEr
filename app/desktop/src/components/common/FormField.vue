<script setup lang="ts">
/**
 * 通用表单字段: 标签 + 控件插槽 + 提示/错误
 */
defineProps<{
	label?: string
	hint?: string
	error?: string
}>()

defineSlots<{
	default?: () => unknown
}>()
</script>

<template>
	<label class="field">
		<span v-if="label" class="field-label">{{ label }}</span>
		<slot/>
		<span v-if="hint" class="field-hint">{{ hint }}</span>
		<span v-if="error" class="field-hint error">{{ error }}</span>
	</label>
</template>
