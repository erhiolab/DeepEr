<script setup lang="ts">
/**
 * Live2D 模型卡片 (已安装区 / 官方区共用)
 */
import Icon from "../common/Icon.vue"
import type {IconName} from "../../services/icon"

export interface ModelCardData {
	id: string
	name: string
}

withDefaults(defineProps<{
	model: ModelCardData
	selected: boolean
	applied: boolean
	coverUrl?: string | null
	iconUrl?: string | null
	coverBroken?: boolean
	iconBroken?: boolean
	placeholderIcon?: IconName
	statusText?: string | null
	statusTone?: "installed" | "missing" | "accent"
	sizeText?: string | null
}>(), {
	coverUrl: null,
	iconUrl: null,
	coverBroken: false,
	iconBroken: false,
	placeholderIcon: "cube",
	statusText: null,
	statusTone: "accent",
	sizeText: null,
})

const emit = defineEmits<{
	(e: "select"): void
	(e: "open"): void
	(e: "cover-error"): void
	(e: "icon-error"): void
}>()
</script>

<template>
	<button
		class="model-card"
		:class="{selected}"
		@click.stop="emit('select')"
		@dblclick.stop="emit('open')"
	>
		<span class="model-thumb-wrap">
			<img
				v-if="coverUrl && !coverBroken"
				:src="coverUrl"
				class="model-thumb"
				alt=""
				loading="lazy"
				@error="emit('cover-error')"
			/>
			<img
				v-else-if="iconUrl && !iconBroken"
				:src="iconUrl"
				class="model-thumb"
				alt=""
				loading="lazy"
				@error="emit('icon-error')"
			/>
			<span v-else class="model-thumb model-placeholder">
				<Icon :name="placeholderIcon" :size="42"/>
			</span>
			<span class="check-badge" :class="{on: applied}">
				<Icon name="check"/>
			</span>
		</span>
		<span class="model-name">{{ model.name }}</span>
		<span class="model-meta">
			<span v-if="statusText" class="status-badge" :class="statusTone">{{ statusText }}</span>
			<span v-if="sizeText" class="model-size">{{ sizeText }}</span>
		</span>
	</button>
</template>

<style scoped lang="less">
.model-card {
	padding: 0.8rem 0.8rem 1.0rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.7rem;
	border: 0.2rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.04);
	cursor: pointer;
	font-family: inherit;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.08);
		border-color: var(--deep-teal-soft);
		transform: translateY(-0.2rem);
	}

	&.selected {
		border-color: var(--deep-teal);
		background-color: rgba(125, 227, 255, 0.1);
		box-shadow: 0 0 1.6rem var(--glow-teal-soft);
	}

	.model-thumb-wrap {
		width: 16rem;
		height: 16rem;
		display: grid;
		grid-template-areas: "thumb";
		place-items: center;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background-color: rgba(255, 255, 255, 0.03);

		.model-thumb {
			grid-area: thumb;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		.model-placeholder {
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-faint);
		}

		.check-badge {
			margin: 0.5rem;
			width: 1.8rem;
			height: 1.8rem;
			grid-area: thumb;
			align-self: start;
			justify-self: end;
			border-radius: 50%;
			background-color: var(--bg-deep);
			border: 0.15rem solid var(--line-strong);
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			opacity: 0.35;
			transition: all 0.2s ease;

			:deep(svg) {
				width: 1.1rem;
				height: 1.1rem;
			}

			&.on {
				opacity: 1;
				background-color: var(--deep-teal);
				border-color: var(--deep-teal);
				color: #05121a;
				transform: scale(1);
			}
		}
	}

	.model-name {
		font-size: 1.3rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.model-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;

		.status-badge {
			padding: 0.15rem 0.6rem;
			font-size: 1rem;
			border-radius: 99.9rem;
			border: 0.1rem solid currentColor;

			&.installed {
				color: var(--deep-teal-soft);
			}

			&.missing {
				color: var(--text-faint);
			}

			&.accent {
				color: var(--deep-teal-bright);
			}
		}

		.model-size {
			font-size: 1.1rem;
			color: var(--text-faint);
			font-variant-numeric: tabular-nums;
		}
	}
}
</style>
