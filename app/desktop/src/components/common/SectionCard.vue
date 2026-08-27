<script setup lang="ts">
/**
 * 通用分区卡片: 标题(可选图标/副标题/右侧操作) + 主体 + 可选底部操作
 */
import Icon from "./Icon.vue"
import type {IconName} from "../../services/icon"

withDefaults(defineProps<{
	title?: string
	icon?: IconName
	subtitle?: string
	scroll?: boolean
}>(), {})

defineSlots<{
	default?: () => unknown
	actions?: () => unknown
	footer?: () => unknown
}>()
</script>

<template>
	<section class="section-card">
		<header v-if="title || icon || subtitle || $slots.actions" class="section-card-head">
			<span v-if="icon" class="section-card-icon">
				<Icon :name="icon" :size="16"/>
			</span>
			<span v-if="title" class="section-card-title">{{ title }}</span>
			<div v-if="subtitle || $slots.actions" class="section-card-right">
				<span v-if="subtitle" class="section-card-sub">{{ subtitle }}</span>
				<div v-if="$slots.actions" class="section-card-actions">
					<slot name="actions"/>
				</div>
			</div>
		</header>
		<div class="section-card-body" :class="{scroll}">
			<slot/>
		</div>
		<footer v-if="$slots.footer" class="section-card-footer">
			<slot name="footer"/>
		</footer>
	</section>
</template>

<style scoped lang="less">
.section-card {
	padding: 1.1rem 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.02);
	box-sizing: border-box;

	.section-card-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.7rem;

		.section-card-icon {
			width: 2.2rem;
			height: 2.2rem;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border-radius: var(--radius-sm);
			color: var(--deep-teal-bright);
			background-color: rgba(125, 227, 255, 0.1);
			flex-shrink: 0;
		}

		.section-card-title {
			font-size: 1.3rem;
			font-weight: 600;
			color: var(--deep-teal-bright);
			text-shadow: 0 0 1.2rem var(--glow-teal-soft);
		}

		.section-card-right {
			margin-left: auto;
			display: flex;
			align-items: center;
			gap: 0.7rem;
		}

		.section-card-sub {
			font-size: 1rem;
			color: var(--text-faint);
		}

		.section-card-actions {
			display: flex;
			align-items: center;
			gap: 0.6rem;
		}
	}

	.section-card-body {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		min-width: 0;

		// 仅当卡片被外部限制高度时启用内部滚动
		&.scroll {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
		}
	}

	.section-card-footer {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.9rem;
		padding-top: 0.9rem;
		border-top: 0.1rem solid var(--line-subtle);
	}
}
</style>
