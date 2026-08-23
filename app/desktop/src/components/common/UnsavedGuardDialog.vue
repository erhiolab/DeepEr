<script setup lang="ts">
import {useUnsavedGuard} from "../../services/store/unsaved.ts"
import Icon from "./Icon.vue"

const GUARD = useUnsavedGuard()
</script>

<template>
	<Teleport to="body">
		<Transition name="confirm">
			<div v-if="GUARD.open" class="confirm-overlay" @click.self="GUARD.cancel">
				<div class="confirm-panel" role="alertdialog" aria-modal="true">
					<header class="confirm-head">
						<div class="confirm-title-row">
							<Icon name="info" :size="18" class="confirm-warn-icon"/>
							<h3 class="confirm-title">{{ GUARD.title }}</h3>
						</div>
						<button class="confirm-close" @click="GUARD.cancel">✕</button>
					</header>
					<p class="confirm-message">{{ GUARD.message }}</p>
					<footer class="confirm-actions">
						<button class="confirm-btn danger" @click="GUARD.discard">{{ GUARD.dangerLabel }}</button>
						<button class="confirm-btn primary" @click="GUARD.save">{{ GUARD.primaryLabel }}</button>
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

	.confirm-title-row {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;

		.confirm-warn-icon {
			color: var(--warning);
			flex-shrink: 0;
		}

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
}

.confirm-message {
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

	.confirm-btn {
		padding: 0.7rem 1.4rem;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: inherit;
		font-size: 1.2rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;

		&.danger {
			border: 0.1rem solid var(--line-strong);
			background-color: transparent;
			color: var(--text-muted);

			&:not(:disabled):hover {
				color: var(--danger);
				border-color: var(--danger);
			}
		}

		&.primary {
			border: none;
			color: #05121a;
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));

			&:not(:disabled):hover {
				box-shadow: 0 0 1.4rem var(--glow-teal-soft);
			}
		}
	}
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
