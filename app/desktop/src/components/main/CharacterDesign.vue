<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {open} from "@tauri-apps/plugin-dialog"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {useUnsavedGuard} from "../../services/store/unsaved"
import {useConversationStore} from "../../services/store/conversation"
import Icon from "../common/Icon.vue"
import ConfirmDialog from "../common/ConfirmDialog.vue"
import PageHeader from "../common/PageHeader.vue"
import EmptyState from "../common/EmptyState.vue"
import SectionCard from "../common/SectionCard.vue"
import FormField from "../common/FormField.vue"
import {
	createPersona,
	deletePersona,
	emptyPersonaInput,
	getSelectedPersonaId,
	importPersonaFile,
	listPersonas,
	PERSONA_SOURCE_SILLYTAVERN,
	personaAvatarUrl,
	selectPersona,
	updatePersona,
	type Persona,
	type PersonaInput,
} from "../../services/persona"

const I18N = computed(() => useLanguages().components.main.characterDesign)

const GUARD = useUnsavedGuard()

const CONV = useConversationStore()

// 人设列表 (按创建顺序)
const personas = ref<Persona[]>([])

// 正在编辑的人设 id (null = 新建草稿)
const editingId = ref<number | null>(null)

// 当前启用的人设 id (存于主配置 selected_persona_id)
const activeId = ref<number | null>(null)

// 编辑草稿
const draft = ref<PersonaInput>(emptyPersonaInput())

// 是否已加载完成
const loaded = ref(false)

// 编辑器是否展开 (新建 / 编辑 / 导入后为 true)
const draftOpen = ref(false)

// 是否有未保存修改
const dirty = ref(false)

// 保存中
const saving = ref(false)

// 导入中
const importing = ref(false)

// 名称错误标记 (保存失败时点亮)
const nameError = ref(false)

// 页面反馈
const feedback = ref<{ type: "ok" | "error"; text: string } | null>(null)

// 删除确认目标
const deleteTarget = ref<Persona | null>(null)

// 头像加载失败的人设 id
const brokenAvatars = ref<number[]>([])

// 程序化赋值草稿时跳过脏标记
let syncing = false

// 草稿变化标记为未保存
watch(draft, () => {
	if (loaded.value && !syncing) dirty.value = true
}, {deep: true, flush: "sync"})

// 从 Persona 构造草稿
const draftFromPersona = (persona: Persona): PersonaInput => ({
	name: persona.name,
	personality: persona.personality,
	firstMes: persona.firstMes,
})

// 应用草稿 (程序化赋值, 不触发脏标记)
const applyDraft = (input: PersonaInput, id: number | null): void => {
	syncing = true
	editingId.value = id
	draft.value = input
	draftOpen.value = true
	syncing = false
	dirty.value = false
	nameError.value = false
	feedback.value = null
}

// 人设头像 URL
const avatarUrl = (persona: Persona): string | null => personaAvatarUrl(persona)

// 头像是否加载失败
const isAvatarBroken = (id: number): boolean => brokenAvatars.value.includes(id)

// 标记头像加载失败
const markAvatarBroken = (id: number): void => {
	if (!brokenAvatars.value.includes(id)) brokenAvatars.value.push(id)
}

// 保存当前草稿 (新建或更新), 返回是否成功
const saveCurrent = async (): Promise<boolean> => {
	if (!loaded.value) return true
	const NAME = draft.value.name.trim()
	if (!NAME) {
		nameError.value = true
		feedback.value = {type: "error", text: I18N.value.nameEmpty}
		return false
	}
	saving.value = true
	try {
		if (editingId.value === null) {
			const CREATED = await createPersona(draft.value)
			if (!CREATED) {
				feedback.value = {type: "error", text: I18N.value.saveFailed}
				return false
			}
			personas.value = [...personas.value, CREATED]
			applyDraft(draftFromPersona(CREATED), CREATED.id)
		} else {
			const UPDATED = await updatePersona(editingId.value, draft.value)
			if (!UPDATED) {
				feedback.value = {type: "error", text: I18N.value.saveFailed}
				return false
			}
			personas.value = personas.value.map(item => item.id === UPDATED.id ? UPDATED : item)
			applyDraft(draftFromPersona(UPDATED), UPDATED.id)
		}
		feedback.value = {type: "ok", text: I18N.value.saveDone}
		return true
	} finally {
		saving.value = false
	}
}

// 切换人设前先落盘当前草稿; 新建且未填写的空草稿直接丢弃
const flushDraft = async (): Promise<boolean> => {
	if (!dirty.value) return true
	if (editingId.value === null && !draft.value.name.trim()) {
		applyDraft(emptyPersonaInput(), null)
		draftOpen.value = false
		return true
	}
	return saveCurrent()
}

// 打开某个人设进行编辑
const openPersona = async (persona: Persona): Promise<void> => {
	if (editingId.value === persona.id && !dirty.value) return
	if (!(await flushDraft())) return
	applyDraft(draftFromPersona(persona), persona.id)
}

// 新建人设草稿
const newPersona = async (): Promise<void> => {
	if (!(await flushDraft())) return
	applyDraft(emptyPersonaInput(), null)
}

// 取消新建草稿 (丢弃未保存内容, 回到空状态/列表)
const cancelDraft = (): void => {
	applyDraft(emptyPersonaInput(), null)
	draftOpen.value = false
}

// 设置 / 取消当前启用的人设 (再次点击使用中的卡片则取消)
const toggleActive = async (persona: Persona): Promise<void> => {
	if (activeId.value === persona.id) {
		if (await selectPersona(null)) activeId.value = null
		return
	}
	if (await selectPersona(persona.id)) {
		activeId.value = persona.id
		// 设为人设后触发首轮互动 (有开场白直接用, 没有则发起一次 LLM 请求)
		void CONV.startPersona(persona)
	} else {
		feedback.value = {type: "error", text: I18N.value.saveFailed}
	}
}

// 确认删除弹窗
const confirmDelete = (persona: Persona): void => {
	deleteTarget.value = persona
}

// 执行删除
const doDelete = async (): Promise<void> => {
	const TARGET = deleteTarget.value
	if (!TARGET) return
	const OK = await deletePersona(TARGET.id)
	deleteTarget.value = null
	if (!OK) {
		feedback.value = {type: "error", text: I18N.value.saveFailed}
		return
	}
	personas.value = personas.value.filter(item => item.id !== TARGET.id)
	if (activeId.value === TARGET.id) activeId.value = null
	if (editingId.value === TARGET.id) {
		applyDraft(emptyPersonaInput(), null)
		draftOpen.value = false
	}
	feedback.value = {type: "ok", text: I18N.value.saveDone}
}

// 导入 SillyTavern 角色卡
const importCard = async (): Promise<void> => {
	const FILE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.importCard,
		filters: [{name: I18N.value.importCardFilter, extensions: ["json", "png"]}],
	})
	if (!FILE || Array.isArray(FILE)) return
	importing.value = true
	feedback.value = null
	try {
		const RESULT = await importPersonaFile(FILE)
		if (!RESULT.ok || !RESULT.persona) {
			feedback.value = {type: "error", text: RESULT.error || I18N.value.importFailed}
			return
		}
		if (!(await flushDraft())) return
		personas.value = [...personas.value, RESULT.persona]
		applyDraft(draftFromPersona(RESULT.persona), RESULT.persona.id)
		feedback.value = {type: "ok", text: I18N.value.importDone}
	} finally {
		importing.value = false
	}
}

// 未保存修改守卫 (离开页面时询问保存 / 放弃)
const guardSync = () => ({
	hasUnsaved: () => dirty.value,
	onSave: () => saveCurrent(),
	title: I18N.value.unsavedTitle,
	message: I18N.value.unsavedMessage,
	saveLabel: I18N.value.saveAndLeave,
	discardLabel: I18N.value.discardLeave,
})

onMounted(async () => {
	const LIST = await listPersonas()
	personas.value = LIST
	activeId.value = await getSelectedPersonaId()
	// 默认打开第一个 (优先当前启用的人设)
	const FIRST = LIST.find(item => item.id === activeId.value) ?? LIST[0]
	if (FIRST) applyDraft(draftFromPersona(FIRST), FIRST.id)
	loaded.value = true
	GUARD.register(guardSync())
})

onBeforeUnmount(() => {
	GUARD.unregister()
})

// 来源标签文案
const sourceLabel = (source: string): string => source === PERSONA_SOURCE_SILLYTAVERN ? I18N.value.sourceCard : I18N.value.sourceManual
</script>

<template>
	<section class="page-character">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle">
			<button class="btn-primary action-btn" @click="newPersona">
				<Icon name="add" :size="15"/>
				{{ I18N.newPersona }}
			</button>
			<button class="import-btn" :disabled="importing" @click="importCard">
				<Icon v-if="importing" name="loading" :size="14" class="spin"/>
				<Icon v-else name="import" :size="15"/>
				{{ importing ? I18N.importing : I18N.importCard }}
			</button>
		</PageHeader>

		<div v-if="loaded" class="character-body">
			<EmptyState
				v-if="personas.length === 0 && !draftOpen"
				icon="book-user"
				:title="I18N.empty"
				:hint="I18N.emptyHint"
			/>
			<template v-else>
				<aside v-if="personas.length > 0" class="persona-list">
					<div
						v-for="persona in personas"
						:key="persona.id"
						class="persona-card"
						:class="{active: persona.id === editingId, used: persona.id === activeId}"
						@click="openPersona(persona)"
					>
						<div class="persona-avatar">
							<img
								v-if="avatarUrl(persona) && !isAvatarBroken(persona.id)"
								:src="avatarUrl(persona) ?? undefined"
								:alt="persona.name"
								@error="markAvatarBroken(persona.id)"
							/>
							<Icon v-else name="book-user" :size="22" class="avatar-icon"/>
						</div>
						<div class="persona-info">
							<span class="persona-name">{{ persona.name }}</span>
							<span class="persona-desc">
								{{ persona.personality || I18N.selectHint }}
							</span>
							<span class="persona-meta">
								<span class="source-badge">{{ sourceLabel(persona.source) }}</span>
							</span>
						</div>
						<div class="persona-actions" @click.stop>
							<button
								class="persona-use"
								:class="{on: persona.id === activeId}"
								@click="toggleActive(persona)"
							>
								<Icon v-if="persona.id === activeId" name="check" :size="12"/>
								{{ persona.id === activeId ? I18N.used : I18N.use }}
							</button>
							<button class="persona-delete" :title="I18N.delete" @click="confirmDelete(persona)">
								<Icon name="close" :size="13"/>
							</button>
						</div>
					</div>
				</aside>

				<div class="persona-editor">
					<template v-if="draftOpen">
						<SectionCard
							scroll
							:title="editingId === null ? I18N.newPersona : (draft.name || I18N.title)"
						>
							<template #actions>
							<span v-if="editingId !== null && editingId === activeId" class="used-tag">
								<Icon name="check" :size="11"/>
								{{ I18N.used }}
							</span>
							</template>
						<div class="editor-form">
							<FormField :label="I18N.name" :error="nameError ? I18N.nameEmpty : undefined">
								<input
									v-model="draft.name"
									class="input"
									:class="{invalid: nameError}"
									:placeholder="I18N.namePlaceholder"
									@input="nameError = false"
								/>
							</FormField>
							<FormField :label="I18N.personality" class="persona-field">
								<textarea
									v-model="draft.personality"
									class="input textarea"
									:placeholder="I18N.personalityPlaceholder"
								/>
							</FormField>
							<FormField :label="I18N.firstMes" class="opening-field">
								<textarea
									v-model="draft.firstMes"
									class="input textarea"
									:placeholder="I18N.firstMesPlaceholder"
								/>
							</FormField>
						</div>
							<template #footer>
								<button
									v-if="editingId === null"
									class="btn ghost"
									:disabled="saving"
									@click="cancelDraft"
								>
									{{ I18N.cancel }}
								</button>
								<button class="btn-primary action-btn" :disabled="saving" @click="saveCurrent">
									<Icon v-if="saving" name="loading" :size="14" class="spin"/>
									{{ saving ? I18N.saving : I18N.save }}
								</button>
							</template>
						</SectionCard>
					</template>
					<EmptyState v-else icon="book-user" :hint="I18N.selectHint"/>
				</div>
			</template>
		</div>

		<div v-if="feedback" class="character-feedback" :class="feedback.type">
			{{ feedback.text }}
		</div>

		<ConfirmDialog
			:open="!!deleteTarget"
			:title="I18N.deleteConfirmTitle"
			:message="deleteTarget ? I18N.deleteConfirmMessage(deleteTarget.name) : ''"
			:confirm-text="I18N.delete"
			danger
			@update:open="deleteTarget = null"
			@confirm="doDelete"
			@cancel="deleteTarget = null"
		/>
	</section>
</template>

<style scoped lang="less">
.page-character {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.action-btn {
	padding: 0.8rem 1.6rem;
	font-size: 1.25rem;

	&:disabled {
		opacity: 0.5;
		cursor: default;
	}
}

.import-btn {
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

.character-body {
	flex: 1;
	min-height: 0;
	display: flex;
	gap: 1rem;
}

.persona-list {
	width: 27rem;
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	overflow-y: auto;
	padding-right: 0.2rem;
}

.persona-card {
	display: flex;
	align-items: center;
	gap: 0.9rem;
	padding: 0.8rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.03);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal-soft);
		background-color: rgba(125, 227, 255, 0.06);
	}

	&.active {
		border-color: var(--deep-teal);
		background-color: rgba(125, 227, 255, 0.1);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}

	&.used {
		box-shadow: inset 0.3rem 0 0 var(--deep-teal-bright);
	}
}

.persona-avatar {
	width: 4.8rem;
	height: 4.8rem;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: var(--radius-sm);
	background-color: var(--bg-deep);
	overflow: hidden;

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-icon {
		color: var(--deep-teal-soft);
	}
}

.persona-info {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.persona-name {
	font-size: 1.25rem;
	font-weight: 600;
	color: var(--text-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.persona-desc {
	font-size: 1rem;
	line-height: 1.5;
	color: var(--text-faint);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	word-break: break-all;
}

.persona-meta {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.source-badge {
	padding: 0.1rem 0.6rem;
	font-size: 0.9rem;
	border-radius: 99.9rem;
	background-color: rgba(125, 227, 255, 0.12);
	color: var(--deep-teal-soft);
}

.persona-actions {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 0.4rem;
}

.persona-use {
	padding: 0.3rem 0.7rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.3rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: 99.9rem;
	background-color: transparent;
	color: var(--text-muted);
	font-family: inherit;
	font-size: 1rem;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal-soft);
		color: var(--deep-teal-bright);
	}

	&.on {
		border-color: var(--deep-teal);
		background-color: rgba(125, 227, 255, 0.12);
		color: var(--deep-teal-bright);
	}
}

.persona-delete {
	width: 2.2rem;
	height: 2.2rem;
	align-self: center;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: 50%;
	background-color: transparent;
	color: var(--text-faint);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(251, 44, 54, 0.12);
		color: var(--danger);
	}
}

.persona-editor {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.persona-editor :deep(.section-card) {
	flex: 1;
	min-height: 0;
}

.editor-form {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	padding-right: 0.4rem;

	.field:first-child {
		flex-shrink: 0;
	}

	.persona-field,
	.opening-field {
		flex: 1;
		min-height: 0;
	}

	.persona-field {
		flex: 1.6;
	}

	.input.textarea {
		width: 100%;
		flex: 1;
		min-height: 0;
		resize: none;
	}
}

.used-tag {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.15rem 0.7rem;
	font-size: 1rem;
	font-weight: 600;
	border-radius: 99.9rem;
	background-color: rgba(125, 227, 255, 0.12);
	color: var(--deep-teal-bright);
	flex-shrink: 0;
}

.character-feedback {
	flex-shrink: 0;
	padding: 0.7rem 1.2rem;
	border-radius: var(--radius-sm);
	font-size: 1.1rem;
	word-break: break-all;

	&.ok {
		color: var(--touch-ok);
		border: 0.1rem solid rgba(127, 224, 160, 0.25);
		background-color: rgba(127, 224, 160, 0.08);
	}

	&.error {
		color: var(--danger);
		border: 0.1rem solid rgba(251, 44, 54, 0.25);
		background-color: rgba(251, 44, 54, 0.08);
	}
}

</style>
