<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {useLangGroups} from "../../../services/i18n/useLanguages.ts"
import {logger} from "../../../services/logger"
import {useUnsavedGuard} from "../../../services/store/unsaved.ts"
import {useLLMStore} from "../../../services/store/llm.ts"
import Icon from "../../common/Icon.vue"
import SectionCard from "../../common/SectionCard.vue"
import FormField from "../../common/FormField.vue"
import {OPENAI_REASONING_EFFORTS} from "../../../services/llm/openairesponses"
import type {LLMAdapter, LLMModelInfo} from "../../../services/llm/types"

const {llm: I18N, label: COMMON_I18N} = useLangGroups({
	llm: "components.main.llm",
	label: "common.label",
})

const props = defineProps<{
	adapter: LLMAdapter
}>()

const GUARD = useUnsavedGuard()

// LLM 统一状态入口 (生成 / 测试按激活适配器路由)
const LLM_STORE = useLLMStore()

// 内容摘要字段名 (所有平台的配置结构一致)
const K = {
	baseUrl: "baseUrl" as const,
	apiKey: "apiKey" as const,
	model: "model" as const,
	reasoningEffort: "reasoningEffort" as const,
}

// 当前适配器表单
interface LLMConfigForm {
	baseUrl: string
	apiKey: string
	model: string
	reasoningEffort?: string
}

// 当前适配器表单
const config = ref<LLMConfigForm>({baseUrl: "", apiKey: "", model: "", reasoningEffort: "medium"})

// 是否 OpenAI Responses 适配器 (用于展示思考等级下拉)
const isOpenAiResponses = computed(() => props.adapter.id === "openai-responses")

// 思考等级下拉选项
const reasoningOptions = computed(() =>
	OPENAI_REASONING_EFFORTS.map(effort => ({
		value: effort,
		label: effort === "" ? I18N.value.reasoningDefault : (I18N.value as unknown as Record<string, string>)[`reasoning${effort.charAt(0).toUpperCase()}${effort.slice(1)}`] ?? effort,
	})),
)

// 是否已加载完成
const loaded = ref(false)

// 是否有未保存修改
const dirty = ref(false)

const GUARD_SYNC = () => ({
	hasUnsaved: () => dirty.value,
	onSave: async () => save(),
	title: I18N.value.unsavedTitle,
	message: I18N.value.unsavedMessage,
	saveLabel: I18N.value.saveAndLeave,
	discardLabel: I18N.value.discardLeave,
})

onMounted(async () => {
	await reload()
	await LLM_STORE.init()
	GUARD.register(GUARD_SYNC())
})

onBeforeUnmount(() => {
	GUARD.unregister()
})

// 适配器切换时, 防止复用一个挂载点, 重新加载配置
watch(() => props.adapter, async () => {
	await reload()
}, {immediate: false})

// 加载配置 (apiKey 不回显明文, 恒置空, 只判断是否已保存过 Key)
const reload = async () => {
	dirty.value = false
	config.value = (await props.adapter.loadConfig()) as unknown as LLMConfigForm
	// 只写不回读: 已保存的 Key 不填入输入框 (留空表示"不动")
	config.value.apiKey = ""
	keyConfigured.value = props.adapter.hasApiKey ? await props.adapter.hasApiKey() : false
	loaded.value = true
}

// 是否已保存过 API Key
const keyConfigured = ref(false)

// 是否正在清除密钥
const clearingKey = ref(false)

// 清除已保存的 API Key
const clearKey = async () => {
	if (clearingKey.value) return
	clearingKey.value = true
	try {
		if (props.adapter.clearApiKey) await props.adapter.clearApiKey()
		keyConfigured.value = false
		config.value.apiKey = ""
		markDirty()
	} finally {
		clearingKey.value = false
	}
}

// 标记修改
const markDirty = () => {
	if (loaded.value) dirty.value = true
}

watch(config, markDirty, {deep: true, flush: "sync"})

// 测试连接状态
const testing = computed(() => LLM_STORE.testing)

// 测试连接结果
const testResult = ref<{ ok: boolean; message: string } | null>(null)

// 测试连接
const testConnection = async () => {
	if (dirty.value) {
		if (saving.value) return
		const OK = await save()
		if (!OK) return
	}
	testResult.value = null
	const RESULT = await LLM_STORE.testConnection()
	if (!RESULT) {
		testResult.value = {ok: false, message: I18N.value.unenabledHint}
		return
	}
	if (RESULT.ok) {
		testResult.value = {ok: true, message: `${RESULT.status ?? "OK"} · ${I18N.value.testOk}`}
	} else {
		testResult.value = {ok: false, message: RESULT.error || I18N.value.testFail}
	}
}

// 是否正在保存
const saving = ref(false)

// 保存错误
const saveError = ref("")

// 保存配置, 返回是否保存成功
const save = async (): Promise<boolean> => {
	saving.value = true
	saveError.value = ""
	try {
		await props.adapter.saveConfig(config.value)
		dirty.value = false
		return true
	} catch (error) {
		saveError.value = String(error)
		await logger.error("保存 LLM 配置失败", error)
		return false
	} finally {
		saving.value = false
	}
}

// API Key 明文/密文切换
const showApiKey = ref(false)

// 候选模型列表 (预设 + 拉取到的)
const modelOptions = ref<LLMModelInfo[]>([])

// 是否正在拉取模型列表
const modelsLoading = ref(false)

// 下拉是否展开
const modelOpen = ref(false)

// 搜索词
const modelSearch = ref("")

// 组合框根节点 (用于点击外部关闭)
const modelBox = ref<HTMLElement | null>(null)

// 展开时已初载的标记 (避免重复拉取)
let modelsTouched = false

// 拉取模型列表并填充候选 (首选项: API 实时, 失败则回落为当前输入)
const refreshModels = async () => {
	if (modelsLoading.value) return
	modelsLoading.value = true
	try {
		const LIST = await props.adapter.listModels()
		if (LIST.length > 0) {
			modelOptions.value = LIST
			modelsTouched = true
		}
	} finally {
		modelsLoading.value = false
	}
}

// 首次展开时预载模型候选 (Anthropic 直接给预设, OpenAI/Google 实时拉取, 失败预留手填)
watch(modelOpen, async (open) => {
	if (open && !modelsTouched) {
		await refreshModels()
	}
})

// 点击输入框时展开, 外部点击关闭
const onModelFocus = () => {
	modelOpen.value = true
}

// 点击外部关闭下拉
const onDocPointerDown = (e: PointerEvent) => {
	if (modelBox.value && !modelBox.value.contains(e.target as Node)) {
		modelOpen.value = false
	}
}

onMounted(() => document.addEventListener("pointerdown", onDocPointerDown))

onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocPointerDown))

// 选择候选模型
const pickModel = (model: LLMModelInfo) => {
	config.value[K.model] = model.id
	modelSearch.value = model.id
	modelOpen.value = false
}

// 当前输入框展示值: 搜索时显示搜索词, 否则显示已选模型
const modelDisplay = computed(() =>
	modelOpen.value ? modelSearch.value : config.value[K.model],
)

// 输入: 同步模型值 + 搜索词, 并展开下拉
const onModelInput = (e: Event) => {
	const VALUE = (e.target as HTMLInputElement).value
	config.value[K.model] = VALUE
	modelSearch.value = VALUE
	modelOpen.value = true
}

// 切换展开 / 收起
const toggleModel = () => {
	modelOpen.value = !modelOpen.value
	if (modelOpen.value) {
		modelSearch.value = config.value[K.model]
	}
}

// 按搜索词过滤后的候选项
const filteredModels = computed(() => {
	const QUERY = modelSearch.value.trim().toLowerCase()
	if (!QUERY) return modelOptions.value
	return modelOptions.value.filter(m => m.id.toLowerCase().includes(QUERY) || (m.label ?? "").toLowerCase().includes(QUERY),)
})

</script>

<template>
	<div class="llm-panel">
		<SectionCard :title="I18N.serverTitle">
			<div class="llm-row">
				<FormField :label="COMMON_I18N.url" class="grow">
					<input
						v-model="config[K.baseUrl]"
						class="input"
						type="text"
						spellcheck="false"
						:placeholder="'https://api.example.com'"
					>
				</FormField>
			</div>
			<div class="llm-row">
				<FormField :label="I18N.apiKey" class="grow">
					<span class="key-row">
						<input
							v-model="config[K.apiKey]"
							class="input"
							:type="showApiKey ? 'text' : 'password'"
							autocomplete="new-password"
							spellcheck="false"
							:placeholder="keyConfigured ? I18N.keyPlaceholderSet : I18N.keyPlaceholderEmpty"
						>
						<button
							class="btn ghost icon-btn"
							:title="showApiKey ? I18N.hideKey : I18N.showKey"
							@click="showApiKey = !showApiKey"
						>
							<Icon :name="showApiKey ? 'eye-off' : 'eye'" :size="16"/>
						</button>
						<button
							v-if="keyConfigured"
							class="btn ghost icon-btn key-clear"
							:title="I18N.clearKey"
							:disabled="clearingKey"
							@click="clearKey"
						>
							<Icon v-if="clearingKey" name="loading" class="spin" :size="14"/>
							<Icon v-else name="close" :size="14"/>
						</button>
					</span>
					<span class="field-status" :class="keyConfigured ? 'set' : 'empty'">
						{{ keyConfigured ? I18N.keySaved : I18N.keyNotSaved }}
					</span>
				</FormField>
			</div>
			<div class="llm-row">
				<FormField :label="COMMON_I18N.modelName" class="grow">
					<div class="model-box" ref="modelBox">
						<input
							:value="modelDisplay"
							class="input model-input"
							type="text"
							spellcheck="false"
							:placeholder="'gpt-4o-mini / claude-... / gemini-...'"
							:disabled="modelsLoading"
							@focus="onModelFocus"
							@input="onModelInput"
						>
						<button
							class="btn ghost icon-btn model-refresh"
							:title="I18N.refreshModels"
							:disabled="modelsLoading"
							@click="refreshModels"
						>
							<Icon :name="modelsLoading ? 'loading' : 'refresh'" :size="14"/>
						</button>
						<button
							class="btn ghost icon-btn model-caret"
							:title="I18N.showModels"
							@click="toggleModel"
						>
							<Icon name="arrow-down" :size="14"/>
						</button>
						<ul v-if="modelOpen" class="model-list">
							<li
								v-for="m in filteredModels"
								:key="m.id"
								class="model-item"
								@click="pickModel(m)"
							>
								<span class="model-name">{{ m.label ?? m.id }}</span>
								<span class="model-id">{{ m.id }}</span>
							</li>
							<li v-if="filteredModels.length === 0" class="model-empty">
								{{ modelsLoading ? I18N.modelsLoading : I18N.modelsEmpty }}
							</li>
						</ul>
					</div>
				</FormField>
				<button class="btn test-btn" :disabled="testing" @click="testConnection">
					<Icon v-if="testing" name="loading" class="spin" :size="14"/>
					{{ testing ? I18N.testing : COMMON_I18N.test }}
				</button>
			</div>
			<div v-if="isOpenAiResponses" class="llm-row">
				<FormField :label="I18N.reasoningEffort" class="grow">
					<select v-model="config[K.reasoningEffort]" class="input select">
						<option v-for="opt in reasoningOptions" :key="opt.value" :value="opt.value">
							{{ opt.label }}
						</option>
					</select>
				</FormField>
			</div>
			<p v-if="testResult" class="test-result" :class="{ok: testResult.ok, fail: !testResult.ok}">
				{{ testResult.message }}
			</p>
		</SectionCard>
		<div class="llm-savebar">
			<button class="btn primary save-btn" :disabled="saving" @click="save">
				<Icon v-if="saving" name="loading" class="spin" :size="14"/>
				<Icon v-else name="check" :size="14"/>
				{{ COMMON_I18N.saveConfig }}
			</button>
			<p v-if="saveError" class="inline-error">{{ saveError }}</p>
		</div>
	</div>
</template>

<style scoped lang="less">
.llm-panel {
	flex: none;
	padding: 0.2rem 0.2rem 1rem;
	display: flex;
	flex-direction: column;
	gap: 1.2rem;
	box-sizing: border-box;
}

.llm-row {
	display: flex;
	align-items: flex-end;
	gap: 0.9rem;
}

.key-row {
	display: flex;
	gap: 0.6rem;

	.input {
		flex: 1;
	}
}

.field-status {
	font-size: 0.98rem;

	&.set {
		color: var(--deep-teal-bright);
	}

	&.empty {
		color: var(--text-faint);
	}
}

.model-box {
	position: relative;
	display: flex;
	align-items: center;
	gap: 0.5rem;

	.model-input {
		flex: 1;
		min-width: 0;
	}

	.model-refresh,
	.model-caret {
		flex-shrink: 0;
		padding: 0.7rem 0.75rem;
		height: 3.1rem;
		box-sizing: border-box;
	}

	.model-caret {
		padding: 0.7rem 0.7rem;
	}
}

.model-list {
	position: absolute;
	top: calc(100% + 0.35rem);
	left: 0;
	right: 0;
	z-index: 20;
	margin: 0;
	padding: 0.3rem;
	list-style: none;
	max-height: 15rem;
	overflow-y: auto;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: var(--surface-elevated, #0d1b22);
	box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.45);
}

.model-item {
	padding: 0.45rem 0.6rem;
	border-radius: var(--radius-sm);
	cursor: pointer;
	transition: all 0.15s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.1);
	}

	.model-name {
		display: block;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.model-id {
		display: block;
		font-size: 0.9rem;
		color: var(--text-faint);
	}
}

.model-empty {
	padding: 0.6rem;
	text-align: center;
	font-size: 1rem;
	color: var(--text-muted);
}

.icon-btn {
	padding: 0.7rem 0.9rem;
}

.test-btn {
	height: 3.5rem;
}

.test-result {
	margin: 0;
	font-size: 1.05rem;

	&.ok {
		color: var(--deep-teal-bright);
	}

	&.fail {
		color: var(--danger);
	}
}

.inline-error {
	margin: 0;
	font-size: 1.05rem;
	color: var(--danger);
}

.llm-savebar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.9rem;
	padding: 0.4rem 0;
	flex-shrink: 0;
}

.save-btn {
	padding: 0.85rem 2rem;
}
</style>
