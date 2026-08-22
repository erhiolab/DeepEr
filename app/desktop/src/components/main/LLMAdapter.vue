<script setup lang="ts">
import {computed, onMounted, ref} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {getActiveAdapter, setActiveAdapter, LLM_ADAPTERS} from "../../services/llm/adapters"
import type {LLMAdapterId} from "../../services/llm/types"
import ConfigPanel from "./llm/ConfigPanel.vue"

const I18N = computed(() => useLanguages().components.main.llm)

// 当前启用的适配器 id, null = 不启用
const activeAdapter = ref<LLMAdapterId | null>(null)

// 当前激活适配器实例 (用于给面板传参)
const activeAdapterInstance = computed(() => LLM_ADAPTERS.find(a => a.id === activeAdapter.value) ?? null,)

// 是否已读取启用状态
const ready = ref(false)

onMounted(async () => {
	activeAdapter.value = await getActiveAdapter()
	ready.value = true
})

// 切换启用项 (单选, 互斥, null 表示不启用)
const switchAdapter = async (id: LLMAdapterId | null) => {
	if (id === activeAdapter.value) return
	activeAdapter.value = id
	await setActiveAdapter(id)
}

// 适配器横向滚动栏: 支持鼠标滚轮 (纵向) 滚动, 无需拖动滚动条
const adapterBar = ref<HTMLElement | null>(null)

// 适配器横向滚动栏: 鼠标滚轮 (纵向) 滚动
const onAdapterBarWheel = (e: WheelEvent) => {
	const EL = adapterBar.value
	if (!EL || EL.scrollWidth <= EL.clientWidth) return
	const DELTA = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
	EL.scrollLeft += DELTA
	e.preventDefault()
}

// 渲染用的可选项
const options = computed(() => [
	{id: null as LLMAdapterId | null, label: I18N.value.disabledLabel, description: I18N.value.disabledDesc},
	...LLM_ADAPTERS.map(a => ({id: a.id as LLMAdapterId | null, label: a.label, description: a.description})),
])
</script>

<template>
	<section class="page-llm">
		<header class="llm-head">
			<div>
				<h2 class="llm-title">{{ I18N.title }}</h2>
				<p class="llm-sub">{{ I18N.subtitle }}</p>
			</div>
		</header>
		<nav class="adapter-bar" ref="adapterBar" @wheel="onAdapterBarWheel">
			<button
				v-for="option in options"
				:key="option.id || 'none'"
				class="adapter-item"
				:class="{active: option.id === activeAdapter}"
				:disabled="!ready"
				@click="switchAdapter(option.id)"
			>
				<span class="adapter-radio" :class="{on: option.id === activeAdapter}"/>
				<span class="adapter-text">
					<span class="adapter-label">{{ option.label }}</span>
					<span class="adapter-desc">{{ option.description }}</span>
				</span>
			</button>
		</nav>
		<div class="adapter-panel">
			<ConfigPanel v-if="activeAdapterInstance" :adapter="activeAdapterInstance" :key="activeAdapterInstance.id"/>
			<div v-else class="adapter-placeholder">{{ I18N.disabledHint }}</div>
		</div>
	</section>
</template>

<style scoped lang="less">
.page-llm {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	overflow: hidden;
}

.llm-head {
	flex-shrink: 0;

	.llm-title {
		margin: 0;
		font-size: 1.8rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: 0 0 1.8rem var(--glow-teal), 0 0 6rem var(--glow-teal-soft);
	}

	.llm-sub {
		margin: 0.4rem 0 0;
		font-size: 1.2rem;
		color: var(--text-muted);
	}
}

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

.adapter-panel {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.adapter-placeholder {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--text-muted);
	font-size: 1.2rem;
}
</style>
