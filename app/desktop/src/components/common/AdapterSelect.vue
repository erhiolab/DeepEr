<script setup lang="ts">
/**
 * 通用适配器单选栏
 */
import {ref} from "vue"

export interface AdapterOption {
	id: string | null
	label: string
	description: string
}

withDefaults(defineProps<{
	options: AdapterOption[]
	active: string | null
	disabled?: boolean
}>(), {
	disabled: false,
})

const emit = defineEmits<{
	(e: "change", id: string | null): void
}>()

// 横向滚动栏: 支持鼠标滚轮 (纵向) 滚动
const bar = ref<HTMLElement | null>(null)

const onBarWheel = (e: WheelEvent): void => {
	const EL = bar.value
	if (!EL || EL.scrollWidth <= EL.clientWidth) return
	const DELTA = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
	EL.scrollLeft += DELTA
	e.preventDefault()
}
</script>

<template>
	<nav ref="bar" class="adapter-bar" @wheel="onBarWheel">
		<button
			v-for="option in options"
			:key="option.id || 'none'"
			class="adapter-item"
			:class="{active: option.id === active}"
			:disabled="disabled"
			@click="emit('change', option.id)"
		>
			<span class="adapter-radio" :class="{on: option.id === active}"/>
			<span class="adapter-text">
				<span class="adapter-label">{{ option.label }}</span>
				<span class="adapter-desc">{{ option.description }}</span>
			</span>
		</button>
	</nav>
</template>

<style scoped lang="less">
.adapter-bar {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 0.8rem;
	overflow-x: auto;
}

.adapter-item {
	padding: 0.7rem 1.1rem;
	display: flex;
	align-items: center;
	gap: 0.7rem;
	flex-shrink: 0;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);
	color: var(--text-muted);
	text-align: left;
	font-family: inherit;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		border-color: var(--deep-teal-soft);
		background-color: rgba(125, 227, 255, 0.06);
	}

	&.active {
		border-color: var(--deep-teal);
		background-color: rgba(125, 227, 255, 0.1);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);

		.adapter-label {
			color: var(--deep-teal-bright);
		}
	}

	&:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.adapter-radio {
		width: 1.1rem;
		height: 1.1rem;
		flex-shrink: 0;
		border: 0.15rem solid var(--text-faint);
		border-radius: 50%;
		box-sizing: border-box;
		position: relative;
		transition: all 0.18s ease;

		&.on {
			border-color: var(--deep-teal-bright);
			background-color: var(--deep-teal-bright);
			box-shadow: 0 0 0.4rem var(--glow-teal-soft);
		}
	}

	.adapter-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		white-space: nowrap;
	}

	.adapter-label {
		font-size: 1.2rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
	}

	.adapter-desc {
		font-size: 0.95rem;
		white-space: nowrap;
		color: var(--text-faint);
	}
}
</style>
