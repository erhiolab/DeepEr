<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue"
import {writeText} from "@tauri-apps/plugin-clipboard-manager"
import useLanguages from "../../services/i18n/useLanguages"
import Icon from "../common/Icon.vue"
import PageHeader from "../common/PageHeader.vue"
import EmptyState from "../common/EmptyState.vue"
import {listTools, updateToolKeywords, type ToolDefinition} from "../../services/tools"

const I18N = computed(() => {
	const SNAPSHOT = useLanguages()
	return {
		...SNAPSHOT.components.main.toolList,
		cancel: SNAPSHOT.common.label.cancel,
	}
})

// 全部工具 (当前为内置工具, 来自后端 tools 表)
const tools = ref<ToolDefinition[]>([])

// 是否已加载 / 正在刷新
const loaded = ref(false)
const loading = ref(false)

// 搜索关键词
const query = ref("")

// 当前标签页 ("" = 全部; 按中文标题「类别-名称」的第一个 - 前的类别分组)
const activeCategory = ref("")

// 已展开的工具 id
const expanded = ref<number[]>([])

// 搜索别名编辑草稿 (tool id → 文本, 每行一个别名)
const aliasesDraft = ref<Record<number, string>>({})
const savingAliases = ref<Record<number, boolean>>({})

// 别名保存反馈
const aliasesFeedback = ref<{id: number, ok: boolean} | null>(null)
let aliasesFeedbackTimer: ReturnType<typeof setTimeout> | null = null

const showAliasesFeedback = (id: number, ok: boolean): void => {
	aliasesFeedback.value = {id, ok}
	if (aliasesFeedbackTimer) clearTimeout(aliasesFeedbackTimer)
	aliasesFeedbackTimer = setTimeout(() => {
		aliasesFeedback.value = null
	}, 2200)
}

// 已复制调用名
const copiedName = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

// 复制失败反馈
const copyError = ref(false)
let copyErrorTimer: ReturnType<typeof setTimeout> | null = null

// 刷新工具列表
const reload = async (): Promise<void> => {
	loading.value = true
	try {
		tools.value = await listTools()
	} finally {
		loading.value = false
		loaded.value = true
	}
}

// 工具类别列表 (按中文标题第一个 - 前的类别, 去重排序)
const toolCategories = computed(() => {
	const CATEGORIES = new Set<string>()
	for (const tool of tools.value) {
		const INDEX = tool.label.indexOf("-")
		CATEGORIES.add(INDEX > 0 ? tool.label.slice(0, INDEX) : tool.label)
	}
	return [...CATEGORIES].sort((a, b) => a.localeCompare(b, "zh-CN"))
})

// 当前类别下的工具
const categoryTools = computed(() => {
	if (!activeCategory.value) return tools.value
	return tools.value.filter(tool => {
		const INDEX = tool.label.indexOf("-")
		const CATEGORY = INDEX > 0 ? tool.label.slice(0, INDEX) : tool.label
		return CATEGORY === activeCategory.value
	})
})

// 搜索过滤 (调用名 / 中文标题 / 描述, 在选中类别内过滤)
const filteredTools = computed(() => {
	const KEYWORD = query.value.trim().toLowerCase()
	if (!KEYWORD) return categoryTools.value
	return categoryTools.value.filter(tool =>
		tool.name.toLowerCase().includes(KEYWORD) ||
		tool.label.toLowerCase().includes(KEYWORD) ||
		tool.description.toLowerCase().includes(KEYWORD) ||
		(tool.keywords ?? []).some(k => k.toLowerCase().includes(KEYWORD)),
	)
})

// 标签栏横向滚动 (鼠标滚轮)
const tabBar = ref<HTMLElement | null>(null)
const onTabsWheel = (event: WheelEvent): void => {
	const EL = tabBar.value
	if (!EL || EL.scrollWidth <= EL.clientWidth) return
	const DELTA = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
	EL.scrollLeft += DELTA
	event.preventDefault()
}

// 展开 / 收起工具卡片 (支持同时展开多个)
const toggleExpand = (id: number): void => {
	const NOW_EXPANDED = !expanded.value.includes(id)
	expanded.value = NOW_EXPANDED
		? [...expanded.value, id]
		: expanded.value.filter(item => item !== id)
	if (NOW_EXPANDED) {
		// 展开时同步别名草稿 (每行一个)
		const TOOL = tools.value.find(tool => tool.id === id)
		aliasesDraft.value[id] = (TOOL?.keywords ?? []).join("\n")
	}
}

// 保存搜索别名
const saveAliases = async (tool: ToolDefinition): Promise<void> => {
	const KEYWORDS = (aliasesDraft.value[tool.id] ?? "")
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0)
	savingAliases.value = {...savingAliases.value, [tool.id]: true}
	try {
		const OK = await updateToolKeywords(tool.id, KEYWORDS)
		if (OK) {
			tool.keywords = KEYWORDS
			showAliasesFeedback(tool.id, true)
		} else {
			showAliasesFeedback(tool.id, false)
		}
	} finally {
		savingAliases.value = {...savingAliases.value, [tool.id]: false}
	}
}

// 注册时间展示 (内置工具初始化时间为准)
const formatTime = (timestamp: number): string => timestamp > 0 ? new Date(timestamp * 1000).toLocaleString() : "_"

// 复制调用名到剪贴板
const copyName = async (name: string): Promise<void> => {
	try {
		await writeText(name)
		copiedName.value = name
		copyError.value = false
		if (copyTimer) clearTimeout(copyTimer)
		copyTimer = setTimeout(() => {
			copiedName.value = null
		}, 1600)
	} catch {
		copyError.value = true
		if (copyErrorTimer) clearTimeout(copyErrorTimer)
		copyErrorTimer = setTimeout(() => {
			copyError.value = false
		}, 2600)
	}
}

onMounted(() => {
	void reload()
})

onBeforeUnmount(() => {
	if (copyTimer) clearTimeout(copyTimer)
	if (copyErrorTimer) clearTimeout(copyErrorTimer)
	if (aliasesFeedbackTimer) clearTimeout(aliasesFeedbackTimer)
})
</script>

<template>
	<section class="page-tools">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle">
			<button class="refresh-btn" :disabled="loading" @click="reload">
				<Icon v-if="loading" name="loading" :size="14" class="spin"/>
				<Icon v-else name="refresh" :size="15"/>
				{{ I18N.refresh }}
			</button>
		</PageHeader>

		<div class="tool-search">
			<Icon name="tasks" :size="15" class="search-icon"/>
			<input
				v-model="query"
				class="search-input"
				type="text"
				:placeholder="I18N.searchPlaceholder"
				maxlength="60"
			/>
			<button v-if="query" class="search-clear" :title="I18N.cancel" @click="query = ''">
				<Icon name="close" :size="13"/>
			</button>
		</div>

		<nav ref="tabBar" class="tool-tabs" @wheel="onTabsWheel">
			<button
				class="tool-tab"
				:class="{active: activeCategory === ''}"
				@click="activeCategory = ''"
			>
				{{ I18N.all }}
			</button>
			<button
				v-for="category in toolCategories"
				:key="category"
				class="tool-tab"
				:class="{active: activeCategory === category}"
				@click="activeCategory = category"
			>
				{{ category }}
			</button>
		</nav>

		<div class="tool-stats">
			<span class="tool-total">{{ I18N.total(tools.length) }}</span>
			<span v-if="tools.some(tool => tool.builtin)" class="tool-builtin-count">
				<Icon name="tool-case" :size="12"/>
				{{ I18N.agentHintBuiltin }} {{ tools.filter(tool => tool.builtin).length }}
			</span>
		</div>

		<div class="tool-list">
			<template v-if="loaded && tools.length === 0">
				<EmptyState icon="tool-case" :title="I18N.empty" :hint="I18N.emptyHint"/>
			</template>
			<template v-else-if="loaded && filteredTools.length === 0">
				<EmptyState icon="tasks" :title="I18N.searchEmpty" :hint="I18N.searchEmptyHint"/>
			</template>
			<template v-else>
				<div
					v-for="tool in filteredTools"
					:key="tool.id"
					class="tool-card"
					:class="{open: expanded.includes(tool.id)}"
				>
					<button class="tool-card-head" @click="toggleExpand(tool.id)">
						<span class="tool-label">{{ tool.label }}</span>
						<span v-if="tool.builtin" class="builtin-badge">{{ I18N.builtin }}</span>
						<span class="tool-card-chevron">
							<Icon name="arrow-down" :size="15"/>
						</span>
					</button>
					<div class="tool-card-body">
						<div class="tool-card-inner">
							<p class="tool-desc">{{ tool.description }}</p>
							<div class="tool-meta">
								<span class="meta-item">
									<span class="meta-label">{{ I18N.callName }}</span>
									<code class="meta-value">{{ tool.name }}</code>
									<button class="copy-btn" :title="I18N.copyName" @click="copyName(tool.name)">
										<Icon :name="copiedName === tool.name ? 'check' : 'copy'" :size="13"/>
										{{ copiedName === tool.name ? I18N.copied : I18N.copyName }}
									</button>
								</span>
								<span class="meta-item">
									<span class="meta-label">{{ I18N.registeredAt }}</span>
									<span class="meta-value">{{ formatTime(tool.createdAt) }}</span>
								</span>
							</div>
							<div class="tool-aliases">
								<span class="meta-label">{{ I18N.aliases }}</span>
								<textarea
									v-model="aliasesDraft[tool.id]"
									class="aliases-input"
									:placeholder="I18N.aliasesPlaceholder"
									rows="3"
								/>
								<div class="aliases-actions">
									<button
										class="aliases-save"
										:disabled="savingAliases[tool.id]"
										@click="saveAliases(tool)"
									>
										{{ I18N.save }}
									</button>
									<span
										v-if="aliasesFeedback && aliasesFeedback.id === tool.id"
										class="aliases-feedback"
										:class="aliasesFeedback.ok ? 'ok' : 'error'"
									>
										{{ aliasesFeedback.ok ? I18N.aliasesSaved : I18N.aliasesSaveFailed }}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</template>
		</div>

		<div v-if="copyError" class="tool-feedback error">
			<Icon name="error" :size="14"/>
			{{ I18N.copyFailed }}
		</div>
	</section>
</template>

<style scoped lang="less">
.page-tools {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.refresh-btn {
	padding: 0.8rem 1.6rem;
	display: inline-flex;
	align-items: center;
	gap: 0.6rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);
	color: var(--text-body);
	font-family: inherit;
	font-size: 1.25rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		border-color: var(--deep-teal-soft);
		color: var(--deep-teal-bright);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}
}

.tool-search {
	display: flex;
	align-items: center;
	gap: 0.7rem;
	padding: 0.65rem 0.9rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	transition: all 0.2s ease;

	&:focus-within {
		border-color: var(--deep-teal-soft);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	.search-icon {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text-primary);
		font-size: 1.15rem;
		font-family: inherit;

		&::placeholder {
			color: var(--text-muted);
			opacity: 0.6;
		}
	}

	.search-clear {
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;

		&:hover {
			background-color: rgba(255, 255, 255, 0.08);
			color: var(--text-primary);
		}
	}
}

.tool-stats {
	display: flex;
	align-items: center;
	gap: 1rem;
	font-size: 1.05rem;
	color: var(--text-muted);

	.tool-total {
		font-weight: 600;
		color: var(--text-faint);
	}

	.tool-builtin-count {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.7rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: 99.9rem;
		color: var(--deep-teal-soft);
		background-color: rgba(125, 227, 255, 0.06);
	}
}

.tool-tabs {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 0.6rem;
	overflow-x: auto;
	scrollbar-width: thin;
	padding-bottom: 0.2rem;

	.tool-tab {
		padding: 0.45rem 1.2rem;
		flex-shrink: 0;
		border: 0.1rem solid var(--line-subtle);
		border-radius: 99.9rem;
		background-color: rgba(255, 255, 255, 0.03);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 1.15rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			border-color: var(--deep-teal-soft);
			color: var(--text-primary);
		}

		&.active {
			border-color: var(--deep-teal);
			color: var(--ink-deep);
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
			box-shadow: 0 0 0.8rem var(--glow-teal-soft);
		}
	}
}

.tool-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	padding-right: 0.2rem;
}

.tool-card {
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.02);
	transition: border-color 0.2s ease, box-shadow 0.2s ease;

	&:hover {
		border-color: var(--line-strong);
	}

	&.open {
		border-color: var(--line-strong);
		box-shadow: 0 0 1.4rem var(--glow-teal-soft);
	}

	.tool-card-head {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 1rem 1.1rem;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-family: inherit;
		cursor: pointer;
		text-align: left;

		.tool-label {
			flex: 1;
			min-width: 0;
			font-size: 1.3rem;
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.builtin-badge {
			flex-shrink: 0;
			padding: 0.15rem 0.7rem;
			border: 0.1rem solid var(--line-strong);
			border-radius: 99.9rem;
			font-size: 0.95rem;
			font-weight: 600;
			color: var(--deep-teal-bright);
			background-color: rgba(125, 227, 255, 0.08);
		}

		.tool-card-chevron {
			display: inline-flex;
			align-items: center;
			color: var(--text-muted);
			transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
			flex-shrink: 0;
		}
	}

	// 缓动展开: grid-template-rows 0fr → 1fr, 高度动画平滑且自适应内容
	.tool-card-body {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition: grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;

		.tool-card-inner {
			min-height: 0;
			overflow: hidden;
			padding: 0 1.1rem 1rem;
			display: flex;
			flex-direction: column;
			gap: 0.85rem;
		}
	}

	&.open {
		.tool-card-chevron {
			transform: rotate(180deg);
		}

		.tool-card-body {
			grid-template-rows: 1fr;
			opacity: 1;
		}
	}
}

.tool-desc {
	margin: 0;
	font-size: 1.15rem;
	line-height: 1.7;
	color: var(--text-body);
	white-space: pre-wrap;
	word-break: break-word;
}

.tool-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.7rem 1.6rem;
}

.meta-item {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 1.05rem;
	color: var(--text-muted);

	.meta-label {
		flex-shrink: 0;
	}

	.meta-value {
		color: var(--deep-teal-bright);
		font-family: inherit;
	}
}

.tool-aliases {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-top: 0.4rem;

	.meta-label {
		font-size: 1.05rem;
		color: var(--text-muted);
	}
}

.aliases-input {
	width: 100%;
	padding: 0.6rem 0.8rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background: var(--bg-deep);
	color: var(--text-primary);
	font-family: inherit;
	font-size: 1.1rem;
	line-height: 1.5;
	resize: vertical;
	box-sizing: border-box;

	&:focus {
		outline: none;
		border-color: var(--deep-teal-bright);
	}
}

.aliases-actions {
	display: flex;
	align-items: center;
	gap: 1rem;
}

.aliases-save {
	padding: 0.4rem 1.2rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.08);
	color: var(--deep-teal-bright);
	font-family: inherit;
	font-size: 1.05rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: rgba(125, 227, 255, 0.16);
	}

	&:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
}

.aliases-feedback {
	font-size: 1.05rem;

	&.ok {
		color: var(--touch-ok);
	}

	&.error {
		color: var(--danger);
	}
}

.copy-btn {
	padding: 0.25rem 0.7rem;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--text-faint);
	font-family: inherit;
	font-size: 1rem;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal-soft);
		color: var(--deep-teal-bright);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}
}

.tool-feedback {
	position: fixed;
	right: 2rem;
	bottom: 2rem;
	z-index: 999;
	display: inline-flex;
	align-items: center;
	gap: 0.6rem;
	padding: 0.8rem 1.2rem;
	border-radius: var(--radius-sm);
	font-size: 1.15rem;
	box-shadow: var(--shadow-soft);
	background-color: rgba(8, 26, 46, 0.95);

	&.error {
		color: var(--danger);
		border: 0.1rem solid rgba(251, 44, 54, 0.4);
	}
}
</style>
