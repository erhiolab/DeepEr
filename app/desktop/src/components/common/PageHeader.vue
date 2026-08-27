<script setup lang="ts">
/**
 * 页面统一头部: 标题 + 副标题 + 右侧操作区
 */
defineProps<{
	title?: string
	subtitle?: string
	center?: boolean
}>()

defineSlots<{
	default?: () => unknown
	title?: () => unknown
}>()
</script>

<template>
	<header class="page-head" :class="{center}">
		<div class="page-head-copy">
			<h2 class="page-title">
				<slot name="title">{{ title }}</slot>
			</h2>
			<p v-if="subtitle" class="page-sub">{{ subtitle }}</p>
		</div>
		<div v-if="$slots.default" class="page-head-actions">
			<slot/>
		</div>
	</header>
</template>

<style scoped lang="less">
.page-head {
	flex-shrink: 0;
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 1rem;

	&.center {
		flex-direction: column;
		align-items: center;
		text-align: center;

		.page-head-actions {
			justify-content: center;
		}
	}

	.page-head-copy {
		min-width: 0;
	}

	.page-title {
		margin: 0;
		font-size: 1.8rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: var(--glow-text);
	}

	.page-sub {
		margin: 0.4rem 0 0;
		font-size: 1.2rem;
		color: var(--text-muted);
	}

	.page-head-actions {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
}
</style>
