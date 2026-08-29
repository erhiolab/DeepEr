<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import useLanguages from "../../services/i18n/useLanguages"
import Icon from "../common/Icon.vue"
import PageHeader from "../common/PageHeader.vue"
import SectionCard from "../common/SectionCard.vue"
import EmptyState from "../common/EmptyState.vue"
import ConfirmDialog from "../common/ConfirmDialog.vue"
import FormField from "../common/FormField.vue"
import {
	createMemory,
	deleteMemory,
	listMemories,
	searchMemories,
	updateMemory,
	type MemoryInput,
	type MemoryRecord,
} from "../../services/memory"
import {useUnsavedGuard} from "../../services/store/unsaved"

const I18N = computed(() => {
	const SNAPSHOT = useLanguages()
	return {
		...SNAPSHOT.components.main.memory,
		cancel: SNAPSHOT.common.label.cancel,
		saving: SNAPSHOT.common.label.saving,
		save: SNAPSHOT.common.label.save,
		saveAndLeave: SNAPSHOT.common.label.saveAndLeave,
		discardLeave: SNAPSHOT.common.label.discardLeave,
	}
})

const GUARD = useUnsavedGuard()

// 记忆类型选项
const TYPE_OPTIONS = [
	{value: "fact", labelKey: "typeFact"},
	{value: "preference", labelKey: "typePreference"},
	{value: "project", labelKey: "typeProject"},
	{value: "event", labelKey: "typeEvent"},
	{value: "relationship", labelKey: "typeRelationship"},
	{value: "core", labelKey: "typeCore"},
] as const

const typeLabel = (type: string): string => {
	const OPTION = TYPE_OPTIONS.find(item => item.value === type)
	return OPTION ? I18N.value[OPTION.labelKey] : type
}

// 记忆列表
const memories = ref<MemoryRecord[]>([])
const loaded = ref(false)
const query = ref("")

// 编辑器
const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const dirty = ref(false)
let syncing = false

interface MemoryDraft {
	content: string
	type: string
	importance: number
	confidence: number
	tagsText: string
}

const defaultDraft = (): MemoryDraft => ({
	content: "",
	type: "fact",
	importance: 0.5,
	confidence: 1,
	tagsText: "",
})

const draft = ref<MemoryDraft>(defaultDraft())
const errors = ref<Record<string, string | null>>({})

watch(draft, () => {
	if (editorOpen.value && !syncing) dirty.value = true
}, {deep: true, flush: "sync"})

const applyDraft = (next: MemoryDraft): void => {
	syncing = true
	draft.value = next
	syncing = false
	dirty.value = false
	errors.value = {}
}

// 删除确认
const deleteTarget = ref<MemoryRecord | null>(null)

// 页面反馈
const feedback = ref<{type: "ok" | "error", text: string} | null>(null)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

const showFeedback = (type: "ok" | "error", text: string): void => {
	feedback.value = {type, text}
	if (feedbackTimer) clearTimeout(feedbackTimer)
	feedbackTimer = setTimeout(() => {
		feedback.value = null
	}, 2600)
}

// 加载列表
const load = async (): Promise<void> => {
	memories.value = query.value.trim()
		? await searchMemories(query.value.trim())
		: await listMemories()
	loaded.value = true
}

const filteredMemories = computed(() => memories.value)

// 编辑器
const draftFromMemory = (memory: MemoryRecord): MemoryDraft => ({
	content: memory.content,
	type: memory.type,
	importance: memory.importance,
	confidence: memory.confidence,
	tagsText: memory.tags.join(", "),
})

const openCreate = async (): Promise<void> => {
	if (!(await flushEditor())) return
	editingId.value = null
	applyDraft(defaultDraft())
	editorOpen.value = true
}

const openEdit = async (memory: MemoryRecord): Promise<void> => {
	if (editingId.value === memory.id && !dirty.value) return
	if (!(await flushEditor())) return
	editingId.value = memory.id
	applyDraft(draftFromMemory(memory))
	editorOpen.value = true
}

const closeEditor = (): void => {
	if (!saving.value) {
		editorOpen.value = false
		dirty.value = false
	}
}

const flushEditor = async (): Promise<boolean> => {
	if (!dirty.value) return true
	return await save()
}

const buildInput = (): MemoryInput => ({
	content: draft.value.content.trim(),
	type: draft.value.type,
	importance: draft.value.importance,
	confidence: draft.value.confidence,
	tags: draft.value.tagsText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
})

const save = async (): Promise<boolean> => {
	const NEXT_ERRORS: Record<string, string | null> = {}
	if (!draft.value.content.trim()) NEXT_ERRORS.content = I18N.value.contentEmpty
	errors.value = NEXT_ERRORS
	if (Object.values(NEXT_ERRORS).some(Boolean)) return false

	const INPUT = buildInput()
	saving.value = true
	try {
		const RESULT = editingId.value === null
			? await createMemory(INPUT)
			: await updateMemory(editingId.value, INPUT)
		if (!RESULT) {
			showFeedback("error", I18N.value.saveFailed)
			return false
		}
		editorOpen.value = false
		dirty.value = false
		await load()
		showFeedback("ok", I18N.value.saved)
		return true
	} finally {
		saving.value = false
	}
}

const doDelete = async (): Promise<void> => {
	const TARGET = deleteTarget.value
	if (!TARGET) return
	const OK = await deleteMemory(TARGET.id)
	deleteTarget.value = null
	if (!OK) {
		showFeedback("error", I18N.value.saveFailed)
		return
	}
	if (editingId.value === TARGET.id) {
		editorOpen.value = false
		dirty.value = false
	}
	await load()
}

onMounted(() => {
	void load()
	GUARD.register({
		hasUnsaved: () => dirty.value,
		onSave: () => save(),
		title: I18N.value.title,
		message: I18N.value.saveFailed,
		saveLabel: I18N.value.saveAndLeave,
		discardLabel: I18N.value.discardLeave,
	})
})

onBeforeUnmount(() => {
	GUARD.unregister()
	if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<template>
	<section class="page-memory">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle">
			<button class="btn-primary action-btn" @click="openCreate">
				<Icon name="add" :size="15"/>
				{{ I18N.newMemory }}
			</button>
			<button class="refresh-btn" @click="load">
				<Icon name="refresh" :size="15"/>
				{{ I18N.refresh }}
			</button>
		</PageHeader>

		<div class="memory-body">
			<aside class="memory-side" :class="{withEditor: editorOpen}">
				<div class="memory-search">
					<Icon name="tasks" :size="15" class="search-icon"/>
					<input
						v-model="query"
						class="search-input"
						type="text"
						:placeholder="I18N.searchPlaceholder"
						maxlength="60"
						@input="load"
					/>
					<button v-if="query" class="search-clear" @click="query = ''; load()">
						<Icon name="close" :size="13"/>
					</button>
				</div>

				<div class="memory-list">
					<EmptyState
						v-if="loaded && memories.length === 0"
						icon="database"
						:title="I18N.empty"
						:hint="I18N.emptyHint"
					/>
					<div
						v-for="memory in filteredMemories"
						:key="memory.id"
						class="memory-card"
						:class="{active: editingId === memory.id}"
						@click="openEdit(memory)"
					>
						<div class="memory-head">
							<span class="memory-type" :class="memory.type">{{ typeLabel(memory.type) }}</span>
							<span class="memory-meta">{{ I18N.accessCount(memory.accessCount) }}</span>
							<button class="memory-delete" @click.stop="deleteTarget = memory">
								<Icon name="close" :size="13"/>
							</button>
						</div>
						<p class="memory-content">{{ memory.content }}</p>
						<div class="memory-foot">
							<div class="importance-bar" :title="`${I18N.importance}: ${Math.round(memory.importance * 100)}%`">
								<span class="importance-fill" :style="{width: `${Math.round(memory.importance * 100)}%`}"/>
							</div>
							<div v-if="memory.tags.length" class="memory-tags">
								<span v-for="tag in memory.tags" :key="tag" class="tag-chip">{{ tag }}</span>
							</div>
						</div>
					</div>
				</div>
			</aside>

			<div v-if="editorOpen" class="memory-editor">
				<SectionCard scroll :title="editingId === null ? I18N.newMemory : (draft.content || I18N.title)">
					<template #actions>
						<span class="editor-badge">{{ typeLabel(draft.type) }}</span>
					</template>
					<div class="memory-form">
						<FormField :label="I18N.content" :error="errors.content ?? undefined">
							<textarea
								v-model="draft.content"
								class="input textarea"
								rows="6"
								:placeholder="I18N.contentPlaceholder"
								maxlength="2000"
								@input="errors.content = null"
							/>
						</FormField>
						<div class="form-grid">
							<FormField :label="I18N.type">
								<select v-model="draft.type" class="input select">
									<option v-for="option in TYPE_OPTIONS" :key="option.value" :value="option.value">
										{{ I18N[option.labelKey] }}
									</option>
								</select>
							</FormField>
							<FormField :label="I18N.tags">
								<input
									v-model="draft.tagsText"
									class="input"
									:placeholder="I18N.tagsPlaceholder"
									maxlength="200"
								/>
							</FormField>
						</div>
						<FormField :label="`${I18N.importance} (${Math.round(draft.importance * 100)}%)`" :hint="I18N.importanceHint">
							<input v-model.number="draft.importance" type="range" min="0" max="1" step="0.1"/>
						</FormField>
						<FormField :label="`${I18N.confidence} (${Math.round(draft.confidence * 100)}%)`" :hint="I18N.confidenceHint">
							<input v-model.number="draft.confidence" type="range" min="0" max="1" step="0.1"/>
						</FormField>
					</div>
					<template #footer>
						<button class="btn ghost" :disabled="saving" @click="closeEditor">{{ I18N.cancel }}</button>
						<button class="btn-primary action-btn" :disabled="saving" @click="save">
							<Icon v-if="saving" name="loading" :size="14" class="spin"/>
							{{ saving ? I18N.saving : I18N.save }}
						</button>
					</template>
				</SectionCard>
			</div>
			<EmptyState v-else class="editor-placeholder" icon="database" :hint="I18N.editorHint"/>
		</div>

		<ConfirmDialog
			:open="!!deleteTarget"
			:title="I18N.deleteConfirmTitle"
			:message="I18N.deleteConfirmMessage"
			:confirm-text="I18N.delete"
			danger
			@update:open="deleteTarget = null"
			@confirm="doDelete"
			@cancel="deleteTarget = null"
		/>

		<div v-if="feedback" class="memory-feedback" :class="feedback.type">
			<Icon :name="feedback.type === 'ok' ? 'check' : 'error'" :size="14"/>
			{{ feedback.text }}
		</div>
	</section>
</template>

<style scoped lang="less">
.page-memory {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.action-btn {
	padding: 0.8rem 1.6rem;
	font-size: 1.25rem;
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

	&:hover {
		border-color: var(--deep-teal-soft);
		color: var(--deep-teal-bright);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}
}

.memory-body {
	flex: 1;
	min-height: 0;
	display: flex;
	gap: 1rem;
}

.memory-side {
	flex: 1;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;

	&.withEditor {
		flex: 0 0 34rem;
	}
}

.memory-search {
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
		flex-shrink: 0;

		&:hover {
			background-color: rgba(255, 255, 255, 0.08);
			color: var(--text-primary);
		}
	}
}

.memory-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	padding-right: 0.2rem;
}

.memory-card {
	padding: 0.9rem 1.1rem;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.02);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--line-strong);
	}

	&.active {
		border-color: var(--deep-teal);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}

	.memory-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;

		.memory-type {
			padding: 0.1rem 0.7rem;
			border-radius: 99.9rem;
			font-size: 0.95rem;
			font-weight: 600;
			color: var(--deep-teal-bright);
			background-color: rgba(125, 227, 255, 0.1);
			border: 0.1rem solid var(--line-strong);

			&.core {
				color: var(--warning);
				background-color: rgba(241, 178, 74, 0.1);
				border-color: rgba(241, 178, 74, 0.35);
			}
		}

		.memory-meta {
			font-size: 1rem;
			color: var(--text-faint);
		}

		.memory-delete {
			margin-left: auto;
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
			opacity: 0;
			transition: all 0.2s ease;

			&:hover {
				color: var(--danger);
				background-color: rgba(251, 44, 54, 0.1);
			}
		}
	}

	&:hover .memory-delete {
		opacity: 1;
	}

	.memory-content {
		margin: 0;
		font-size: 1.15rem;
		line-height: 1.6;
		color: var(--text-body);
		white-space: pre-wrap;
		word-break: break-word;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.memory-foot {
		display: flex;
		align-items: center;
		gap: 0.8rem;

		.importance-bar {
			width: 8rem;
			height: 0.4rem;
			flex-shrink: 0;
			border-radius: 99.9rem;
			background-color: rgba(255, 255, 255, 0.08);
			overflow: hidden;

			.importance-fill {
				display: block;
				height: 100%;
				border-radius: 99.9rem;
				background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
			}
		}

		.memory-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4rem;
			min-width: 0;

			.tag-chip {
				padding: 0.1rem 0.6rem;
				border-radius: 99.9rem;
				font-size: 0.95rem;
				color: var(--text-faint);
				background-color: rgba(125, 227, 255, 0.05);
				border: 0.1rem solid var(--line-subtle);
			}
		}
	}
}

.memory-editor {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.memory-editor :deep(.section-card) {
	flex: 1;
	min-height: 0;
}

.editor-placeholder {
	flex: 1;
}

.editor-badge {
	padding: 0.15rem 0.7rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: 99.9rem;
	font-size: 1rem;
	font-weight: 600;
	color: var(--deep-teal-bright);
	background-color: rgba(125, 227, 255, 0.1);
}

.memory-form {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.9rem 1rem;
}

.memory-form :deep(input[type="range"]) {
	width: 100%;
	accent-color: var(--deep-teal-bright);
	cursor: pointer;
}

.memory-feedback {
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

	&.ok {
		color: var(--touch-ok);
		border: 0.1rem solid rgba(127, 224, 160, 0.35);
	}

	&.error {
		color: var(--danger);
		border: 0.1rem solid rgba(251, 44, 54, 0.4);
	}
}
</style>
