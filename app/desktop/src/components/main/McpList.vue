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
	createMcp,
	deleteMcp,
	listMcp,
	setMcpEnabled,
	syncMcp,
	updateMcp,
	type McpServerInput,
	type McpServerRecord,
} from "../../services/mcp"
import {useUnsavedGuard} from "../../services/store/unsaved"

const I18N = computed(() => {
	const SNAPSHOT = useLanguages()
	return {
		...SNAPSHOT.components.main.mcp,
		cancel: SNAPSHOT.common.label.cancel,
		saving: SNAPSHOT.common.label.saving,
		save: SNAPSHOT.common.label.save,
		saveAndLeave: SNAPSHOT.common.label.saveAndLeave,
		discardLeave: SNAPSHOT.common.label.discardLeave,
	}
})

const GUARD = useUnsavedGuard()

const ARGS_PLACEHOLDER = '["-y", "@modelcontextprotocol/server-filesystem"]'
const HEADERS_PLACEHOLDER = '{"Authorization": "Bearer xxx"}'
const ENV_PLACEHOLDER = '{"API_KEY": "xxx"}'

// 服务器列表
const servers = ref<McpServerRecord[]>([])

// 加载状态
const loaded = ref(false)

// 编辑器
const editorOpen = ref(false)

// 编辑器状态
const editingId = ref<number | null>(null)

// 保存状态
const saving = ref(false)

// 未保存状态
const dirty = ref(false)

// 同步状态
let syncing = false

// 同步中状态 (同步工具按钮)
const syncingNow = ref(false)

// MCP 服务器草稿
interface McpDraft {
	name: string
	description: string
	transport: "stdio" | "sse" | "http"
	command: string
	argsText: string
	url: string
	headersText: string
	envText: string
}

// 默认草稿
const defaultDraft = (): McpDraft => ({
	name: "",
	description: "",
	transport: "stdio",
	command: "",
	argsText: "[]",
	url: "",
	headersText: "{}",
	envText: "{}",
})

// 当前草稿
const draft = ref<McpDraft>(defaultDraft())

// 错误状态
const errors = ref<Record<string, string | null>>({})

watch(draft, () => {
	if (editorOpen.value && !syncing) dirty.value = true
}, {deep: true, flush: "sync"})

// 应用草稿
const applyDraft = (next: McpDraft): void => {
	syncing = true
	draft.value = next
	syncing = false
	dirty.value = false
	errors.value = {}
}

// 删除确认
const deleteTarget = ref<McpServerRecord | null>(null)

// 页面反馈
const feedback = ref<{ type: "ok" | "error", text: string } | null>(null)

// 页面反馈定时器
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

// 显示页面反馈
const showFeedback = (type: "ok" | "error", text: string): void => {
	feedback.value = {type, text}
	if (feedbackTimer) clearTimeout(feedbackTimer)
	feedbackTimer = setTimeout(() => {
		feedback.value = null
	}, 2600)
}

// 加载服务器列表
const load = async (): Promise<void> => {
	servers.value = await listMcp()
	loaded.value = true
}

// 传输协议标签
const transportLabel = (transport: string): string => {
	if (transport === "sse") return I18N.value.transportSse
	if (transport === "http") return I18N.value.transportHttp
	return I18N.value.transportStdio
}

// 从服务器记录创建草稿
const draftFromServer = (server: McpServerRecord): McpDraft => ({
	name: server.name,
	description: server.description,
	transport: server.transport,
	command: server.command,
	argsText: JSON.stringify(server.args, null, 2),
	url: server.url,
	headersText: JSON.stringify(server.headers, null, 2),
	envText: JSON.stringify(server.env, null, 2),
})

// 打开创建编辑器
const openCreate = async (): Promise<void> => {
	if (!(await flushEditor())) return
	editingId.value = null
	applyDraft(defaultDraft())
	editorOpen.value = true
}

// 打开编辑编辑器
const openEdit = async (server: McpServerRecord): Promise<void> => {
	if (editingId.value === server.id && !dirty.value) return
	if (!(await flushEditor())) return
	editingId.value = server.id
	applyDraft(draftFromServer(server))
	editorOpen.value = true
}

// 关闭编辑器
const closeEditor = (): void => {
	if (!saving.value) {
		editorOpen.value = false
		dirty.value = false
	}
}

// 刷新编辑器
const flushEditor = async (): Promise<boolean> => {
	if (!dirty.value) return true
	return await save()
}

// 解析 JSON 对象
const parseJsonObject = (text: string): Record<string, string> | null => {
	try {
		const VALUE = JSON.parse(text)
		if (!VALUE || typeof VALUE !== "object" || Array.isArray(VALUE)) return null
		const OUT: Record<string, string> = {}
		for (const [key, value] of Object.entries(VALUE as Record<string, unknown>)) {
			if (typeof value !== "string") return null
			OUT[key] = value
		}
		return OUT
	} catch {
		return null
	}
}

// 解析 JSON 数组
const parseJsonArray = (text: string): unknown[] | null => {
	try {
		const VALUE = JSON.parse(text)
		return Array.isArray(VALUE) ? VALUE : null
	} catch {
		return null
	}
}

// 保存服务器
const save = async (): Promise<boolean> => {
	const NEXT_ERRORS: Record<string, string | null> = {}
	const NAME = draft.value.name.trim()
	if (!NAME) NEXT_ERRORS.name = I18N.value.nameEmpty
	else if (servers.value.some(server => server.id !== editingId.value && server.name === NAME)) {
		NEXT_ERRORS.name = I18N.value.nameDuplicate
	}
	if (draft.value.transport !== "stdio" && draft.value.transport !== "sse" && draft.value.transport !== "http") {
		NEXT_ERRORS.transport = I18N.value.transportInvalid
	}
	if (draft.value.transport === "stdio") {
		if (!draft.value.command.trim()) NEXT_ERRORS.command = I18N.value.commandEmpty
		if (!parseJsonArray(draft.value.argsText)) NEXT_ERRORS.args = I18N.value.argsInvalid
		if (!parseJsonObject(draft.value.envText)) NEXT_ERRORS.env = I18N.value.envInvalid
	} else {
		if (!draft.value.url.trim()) NEXT_ERRORS.url = I18N.value.urlEmpty
		if (!parseJsonObject(draft.value.headersText)) NEXT_ERRORS.headers = I18N.value.headersInvalid
	}
	errors.value = NEXT_ERRORS
	if (Object.values(NEXT_ERRORS).some(Boolean)) return false

	const INPUT: McpServerInput = {
		name: NAME,
		description: draft.value.description.trim(),
		transport: draft.value.transport,
		command: draft.value.transport === "stdio" ? draft.value.command.trim() : "",
		args: draft.value.transport === "stdio" ? parseJsonArray(draft.value.argsText) as unknown[] : [],
		url: draft.value.transport !== "stdio" ? draft.value.url.trim() : "",
		headers: draft.value.transport !== "stdio" ? parseJsonObject(draft.value.headersText) ?? {} : {},
		env: draft.value.transport === "stdio" ? parseJsonObject(draft.value.envText) ?? {} : {},
	}

	saving.value = true
	try {
		const RESULT = editingId.value === null
			? await createMcp(INPUT)
			: await updateMcp(editingId.value, INPUT)
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

// 同步工具 (调用后端 mcp_sync, 发现工具写入 tools 表)
const doSync = async (): Promise<void> => {
	if (syncingNow.value) return
	syncingNow.value = true
	try {
		const RESULTS = await syncMcp()
		const FAILED = RESULTS.filter(result => !result.ok)
		if (FAILED.length > 0) {
			const ERROR = FAILED
				.map(result => `${result.serverName}: ${result.error ?? "未知错误"}`)
				.join("; ")
			showFeedback("error", I18N.value.syncFailed(ERROR))
		} else {
			showFeedback(
				"ok",
				I18N.value.syncDone(String(RESULTS.length), "0")
			)
		}
	} finally {
		syncingNow.value = false
		await load()
	}
}

// 切换服务器状态
const toggleEnabled = async (server: McpServerRecord): Promise<void> => {
	const OK = await setMcpEnabled(server.id, !server.enabled)
	if (OK) await load()
}

// 删除服务器
const doDelete = async (): Promise<void> => {
	const TARGET = deleteTarget.value
	if (!TARGET) return
	const OK = await deleteMcp(TARGET.id)
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
	<section class="page-mcp">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle">
			<button class="btn-primary action-btn" @click="openCreate">
				<Icon name="add" :size="15"/>
				{{ I18N.newMcp }}
			</button>
			<button class="refresh-btn" @click="load">
				<Icon name="refresh" :size="15"/>
				{{ I18N.refresh }}
			</button>
			<button class="refresh-btn" :disabled="syncingNow" @click="doSync">
				<Icon name="refresh" :size="15"/>
				{{ syncingNow ? I18N.syncing : I18N.sync }}
			</button>
		</PageHeader>

		<div class="mcp-body">
			<aside class="mcp-side" :class="{withEditor: editorOpen}">
				<div class="mcp-list">
					<EmptyState
						v-if="loaded && servers.length === 0"
						icon="mcp"
						:title="I18N.empty"
						:hint="I18N.emptyHint"
					/>
					<div
						v-for="server in servers"
						:key="server.id"
						class="mcp-card"
						:class="{active: editingId === server.id, disabled: !server.enabled}"
						@click="openEdit(server)"
					>
						<div class="mcp-head">
							<span class="mcp-name">{{ server.name }}</span>
							<span class="mcp-transport">{{ transportLabel(server.transport) }}</span>
							<div class="mcp-actions">
								<button
									class="mcp-toggle"
									:class="{on: server.enabled}"
									@click.stop="toggleEnabled(server)"
								>
									<Icon :name="server.enabled ? 'check' : 'close'" :size="13"/>
									{{ server.enabled ? I18N.enabled : I18N.disabled }}
								</button>
								<button class="mcp-delete" @click.stop="deleteTarget = server">
									<Icon name="close" :size="13"/>
								</button>
							</div>
						</div>
						<p v-if="server.description" class="mcp-desc">{{ server.description }}</p>
						<div class="mcp-endpoint">
							<span v-if="server.transport === 'stdio'">
								{{ server.command }} {{server.args.join(" ") }}
							</span>
							<span v-else>{{ server.url }}</span>
							<span class="mcp-tool-count">{{ I18N.toolCount(server.toolCount) }}</span>
						</div>
					</div>
				</div>
			</aside>

			<div v-if="editorOpen" class="mcp-editor">
				<SectionCard scroll :title="editingId === null ? I18N.dialogCreate : I18N.dialogEdit">
					<template #actions>
						<span class="editor-badge">{{ transportLabel(draft.transport) }}</span>
					</template>
					<div class="mcp-form">
						<div class="form-grid">
							<FormField :label="I18N.name" :error="errors.name ?? undefined">
								<input
									v-model="draft.name"
									class="input"
									:class="{invalid: !!errors.name}"
									:placeholder="I18N.namePlaceholder"
									maxlength="60"
									@input="errors.name = null"
								/>
							</FormField>
							<FormField :label="I18N.transport" :error="errors.transport ?? undefined">
								<select v-model="draft.transport" class="input select">
									<option value="stdio">{{ I18N.transportStdio }}</option>
									<option value="sse">{{ I18N.transportSse }}</option>
									<option value="http">{{ I18N.transportHttp }}</option>
								</select>
							</FormField>
						</div>
						<FormField :label="I18N.description">
							<input
								v-model="draft.description"
								class="input"
								:placeholder="I18N.descriptionPlaceholder"
								maxlength="200"
							/>
						</FormField>

						<template v-if="draft.transport === 'stdio'">
							<FormField :label="I18N.command" :error="errors.command ?? undefined">
								<input
									v-model="draft.command"
									class="input"
									:class="{invalid: !!errors.command}"
									:placeholder="I18N.commandPlaceholder"
									@input="errors.command = null"
								/>
							</FormField>
							<FormField :label="I18N.args" :error="errors.args ?? undefined">
								<textarea
									v-model="draft.argsText"
									class="input textarea code"
									rows="3"
									:class="{invalid: !!errors.args}"
									:placeholder="ARGS_PLACEHOLDER"
									@input="errors.args = null"
								/>
							</FormField>
							<FormField :label="I18N.env" :error="errors.env ?? undefined">
								<textarea
									v-model="draft.envText"
									class="input textarea code"
									rows="3"
									:class="{invalid: !!errors.env}"
									:placeholder="ENV_PLACEHOLDER"
									@input="errors.env = null"
								/>
							</FormField>
						</template>
						<template v-else>
							<FormField :label="I18N.url" :error="errors.url ?? undefined">
								<input
									v-model="draft.url"
									class="input"
									:class="{invalid: !!errors.url}"
									:placeholder="I18N.urlPlaceholder"
									@input="errors.url = null"
								/>
							</FormField>
							<FormField :label="I18N.headers" :error="errors.headers ?? undefined">
								<textarea
									v-model="draft.headersText"
									class="input textarea code"
									rows="3"
									:class="{invalid: !!errors.headers}"
									:placeholder="HEADERS_PLACEHOLDER"
									@input="errors.headers = null"
								/>
							</FormField>
						</template>
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

		<div v-if="feedback" class="mcp-feedback" :class="feedback.type">
			<Icon :name="feedback.type === 'ok' ? 'check' : 'error'" :size="14"/>
			{{ feedback.text }}
		</div>
	</section>
</template>

<style scoped lang="less">
.page-mcp {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	color-scheme: dark;
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

.mcp-body {
	flex: 1;
	min-height: 0;
	display: flex;
	gap: 1rem;
}

.mcp-side {
	flex: 1;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;

	&.withEditor {
		flex: 0 0 34rem;
	}
}

.mcp-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	padding-right: 0.2rem;
}

.mcp-card {
	padding: 0.9rem 1.1rem;
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
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

	&.disabled {
		opacity: 0.55;
	}

	.mcp-head {
		display: flex;
		align-items: center;
		gap: 0.7rem;

		.mcp-name {
			flex: 1;
			min-width: 0;
			font-size: 1.3rem;
			font-weight: 600;
			color: var(--text-primary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.mcp-transport {
			flex-shrink: 0;
			padding: 0.1rem 0.7rem;
			border: 0.1rem solid var(--line-strong);
			border-radius: 99.9rem;
			font-size: 0.95rem;
			font-weight: 600;
			color: var(--deep-teal-bright);
			background-color: rgba(125, 227, 255, 0.08);
		}

		.mcp-actions {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			gap: 0.4rem;

			.mcp-toggle {
				padding: 0.25rem 0.7rem;
				display: inline-flex;
				align-items: center;
				gap: 0.35rem;
				border: 0.1rem solid var(--line-subtle);
				border-radius: var(--radius-sm);
				background-color: transparent;
				color: var(--text-muted);
				font-family: inherit;
				font-size: 1rem;
				cursor: pointer;
				transition: all 0.2s ease;

				&.on {
					border-color: rgba(127, 224, 160, 0.4);
					color: var(--touch-ok);
					background-color: rgba(127, 224, 160, 0.08);
				}
			}

			.mcp-delete {
				width: 2.2rem;
				height: 2.2rem;
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
	}

	&:hover .mcp-delete {
		opacity: 1;
	}

	.mcp-desc {
		margin: 0;
		font-size: 1.1rem;
		color: var(--text-body);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mcp-endpoint {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 1rem;
		color: var(--text-faint);
		font-family: "Fira Code", "Cascadia Code", monospace;
		overflow: hidden;
	}

	.mcp-endpoint > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.mcp-tool-count {
		margin-left: auto;
		flex-shrink: 0;
		font-family: var(--font-family, inherit);
		color: var(--text-body);
	}
}

.mcp-editor {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.mcp-editor :deep(.section-card) {
	flex: 1;
	min-height: 0;
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

.mcp-form {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;

	input,
	textarea,
	select {
		color: var(--text-primary);
	}

	select option {
		color: var(--text-primary);
		background-color: var(--bg-deep);
	}

	.textarea.code {
		font-family: "Fira Code", "Cascadia Code", monospace;
		font-size: 1.05rem;
	}
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.9rem 1rem;
}

.mcp-feedback {
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
