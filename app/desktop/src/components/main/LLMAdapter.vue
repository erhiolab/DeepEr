<script setup lang="ts">
import {computed, onMounted, ref} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {getActiveAdapter, setActiveAdapter, LLM_ADAPTERS} from "../../services/llm/adapters"
import type {LLMAdapterId} from "../../services/llm/types"
import {useUnsavedGuard} from "../../services/store/unsaved"
import PageHeader from "../common/PageHeader.vue"
import AdapterSelect from "../common/AdapterSelect.vue"
import ConfigPanel from "./llm/ConfigPanel.vue"

const I18N = computed(() => useLanguages().components.main.llm)

const UNSURE_GUARD = useUnsavedGuard()

// 当前启用的适配器 id, null = 不启用
const activeAdapter = ref<LLMAdapterId | null>(null)

// 当前激活适配器实例 (用于给面板传参)
const activeAdapterInstance = computed(() => LLM_ADAPTERS.find(a => a.id === activeAdapter.value) ?? null)

// 是否已读取启用状态
const ready = ref(false)

onMounted(async () => {
	activeAdapter.value = await getActiveAdapter()
	ready.value = true
})

// 切换启用项 (单选, 互斥, null 表示不启用)
const switchAdapter = async (id: string | null) => {
	if (id !== null && !LLM_ADAPTERS.some(adapter => adapter.id === id)) return
	const TARGET = id as LLMAdapterId | null
	if (TARGET === activeAdapter.value) return
	// 当前配置面板可能持有未保存修改, 离开前先询问
	if (!(await UNSURE_GUARD.requestLeave())) return
	activeAdapter.value = TARGET
	await setActiveAdapter(TARGET)
}

// 渲染用的可选项
const options = computed(() => [
	{id: null as string | null, label: I18N.value.disabledLabel, description: I18N.value.disabledDesc},
	...LLM_ADAPTERS.map(a => ({id: a.id, label: a.label, description: a.description})),
])
</script>

<template>
	<section class="page-llm">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle"/>
		<AdapterSelect :options="options" :active="activeAdapter" :disabled="!ready" @change="switchAdapter"/>
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
}

.adapter-panel {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow-y: auto;
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
