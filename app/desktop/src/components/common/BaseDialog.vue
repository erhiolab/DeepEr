<script setup lang="ts">
/**
 * 通用弹窗基底: 遮罩 + 面板 + 标题(带图标插槽) + 消息 + 底部操作区
 */
import Icon from "./Icon.vue"

defineProps<{
	open: boolean
	title: string
	message?: string
}>()

defineSlots<{
	icon?: () => unknown
	default?: () => unknown
	actions?: () => unknown
}>()

const emit = defineEmits<{
	(e: "close"): void
}>()
</script>

<template>
	<Teleport to="body">
		<Transition name="confirm">
			<div v-if="open" class="confirm-overlay" @click.self="emit('close')">
				<div class="confirm-panel" role="alertdialog" aria-modal="true">
					<header class="confirm-head">
						<div class="confirm-title-row">
							<slot name="icon">
								<Icon name="info" :size="18" class="dialog-warn-icon"/>
							</slot>
							<h3 class="confirm-title">{{ title }}</h3>
						</div>
						<button class="confirm-close" @click="emit('close')">✕</button>
					</header>
					<p v-if="message" class="dialog-message">{{ message }}</p>
					<slot/>
					<footer v-if="$slots.actions" class="confirm-actions">
						<slot name="actions"/>
					</footer>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped lang="less">
.confirm-overlay {
	position: fixed;
	padding: 2rem;
	inset: 0;
	z-index: 9999;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(5, 7, 10, 0.72);
	backdrop-filter: blur(0.4rem);
}

.confirm-panel {
	padding: 1.4rem 1.6rem 1.1rem;
	width: min(34rem, 100%);
	display: flex;
	flex-direction: column;
	gap: 1.1rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-md);
	background-image: linear-gradient(160deg, var(--bg-panel), var(--bg-abyss));
	box-shadow: var(--shadow-soft), 0 0 2.6rem var(--glow-teal-soft);
}

.confirm-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.confirm-title-row {
	display: inline-flex;
	align-items: center;
	gap: 0.6rem;

	.confirm-title {
		margin: 0;
		font-size: 1.45rem;
		font-weight: 700;
		color: var(--text-primary);
	}
}

.confirm-close {
	width: 2.2rem;
	height: 2.2rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: 50%;
	background-color: transparent;
	color: var(--text-faint);
	font-size: 1.3rem;
	line-height: 1;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(251, 44, 54, 0.12);
		color: var(--danger);
	}
}

.dialog-message {
	margin: 0;
	font-size: 1.15rem;
	line-height: 1.7;
	color: var(--text-body);
	white-space: pre-wrap;
	word-break: break-word;
}

.confirm-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.9rem;
}

.confirm-enter-active,
.confirm-leave-active {
	transition: opacity 0.2s ease;
}

.confirm-enter-active .confirm-panel,
.confirm-leave-active .confirm-panel {
	transition: transform 0.2s ease;
}

.confirm-enter-from,
.confirm-leave-to {
	opacity: 0;
}

.confirm-enter-from .confirm-panel,
.confirm-leave-to .confirm-panel {
	transform: translateY(0.6rem) scale(0.98);
}
</style>
