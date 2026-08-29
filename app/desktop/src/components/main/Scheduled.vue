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
	createTask,
	deleteTask,
	setTaskEnabled,
	updateTask,
	type ScheduleEntry,
	type TaskDefinition,
} from "../../services/schedule"
import {useScheduleStore} from "../../services/store/schedule"
import {useUnsavedGuard} from "../../services/store/unsaved"

const I18N = computed(() => {
	const SNAPSHOT = useLanguages()
	return {
		...SNAPSHOT.components.main.scheduled,
		cancel: SNAPSHOT.common.label.cancel,
		saving: SNAPSHOT.common.label.saving,
		save: SNAPSHOT.common.label.save,
		saveAndLeave: SNAPSHOT.common.label.saveAndLeave,
		discardLeave: SNAPSHOT.common.label.discardLeave,
	}
})

const STORE = useScheduleStore()
const GUARD = useUnsavedGuard()

// 倒计时 (每秒刷新)
const nowTick = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | null = null

// 下一个任务剩余时间: X天 HH:MM:SS
const countdown = computed<string | null>(() => {
	const AT = STORE.nextTask?.at
	if (!AT) return null
	const REMAIN_MS = AT * 1000 - nowTick.value
	if (REMAIN_MS <= 0) return I18N.value.countdownNow
	const TOTAL_SEC = Math.floor(REMAIN_MS / 1000)
	const DAYS = Math.floor(TOTAL_SEC / 86400)
	const HOURS = Math.floor((TOTAL_SEC % 86400) / 3600)
	const MINUTES = Math.floor((TOTAL_SEC % 3600) / 60)
	const SECONDS = TOTAL_SEC % 60
	const PAD = (n: number): string => String(n).padStart(2, "0")
	const TIME = `${PAD(HOURS)}:${PAD(MINUTES)}:${PAD(SECONDS)}`
	return DAYS > 0 ? `${DAYS} ${I18N.value.day} ${TIME}` : TIME
})

// 是否有未保存修改 (页面离开守卫用)
const dirty = ref(false)
// 程序化赋值草稿时跳过脏标记
let syncing = false

// 星期选项 (1=周一..7=周日)
const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"]
const WEEKDAYS = WEEKDAY_SHORT.map((label, index) => ({value: index + 1, label: `周${label}`}))

// 新建/编辑草稿
interface TaskDraft {
	title: string
	content: string
	kind: "permanent" | "once"
	cycle: "hourly" | "daily" | "weekly"
	minute: number
	weekdays: number[]
	times: string[]
	onceAt: string
}

const defaultDraft = (): TaskDraft => ({
	title: "",
	content: "",
	kind: "permanent",
	cycle: "daily",
	minute: 0,
	weekdays: [1, 2, 3, 4, 5],
	times: ["09:00"],
	onceAt: "",
})

// 编辑器状态
const editorOpen = ref(false)

// 编辑任务ID (null = 新建)
const editingId = ref<number | null>(null)

// 是否正在保存
const saving = ref(false)

// 当前草稿
const draft = ref<TaskDraft>(defaultDraft())

// 校验错误
const errors = ref<Record<string, string | null>>({})

// 草稿变化标记为未保存 (程序化赋值时跳过)
watch(draft, () => {
	if (editorOpen.value && !syncing) dirty.value = true
}, {deep: true, flush: "sync"})

// 程序化赋值草稿 (不触发脏标记)
const applyDraft = (next: TaskDraft): void => {
	syncing = true
	draft.value = next
	syncing = false
	dirty.value = false
	errors.value = {}
}

// 删除确认目标
const deleteTarget = ref<TaskDefinition | null>(null)

// 页面反馈
const feedback = ref<{ type: "ok" | "error", text: string } | null>(null)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

// 显示反馈 (2.6秒后自动隐藏)
const showFeedback = (type: "ok" | "error", text: string): void => {
	feedback.value = {type, text}
	if (feedbackTimer) clearTimeout(feedbackTimer)
	feedbackTimer = setTimeout(() => {
		feedback.value = null
	}, 2600)
}

// 时间格式化
const formatTime = (timestamp: number): string => new Date(timestamp * 1000).toLocaleString()

// 单条时间设定 → 摘要文案
const formatEntry = (entry: ScheduleEntry): string => {
	switch (entry.type) {
		case "once":
			return `${I18N.value.once} ${formatTime(entry.at)}`
		case "hourly":
			return `${I18N.value.hourly} ${entry.minute} ${I18N.value.minute}`
		case "daily":
			return `${I18N.value.daily} ${entry.time}`
		case "weekly":
			return `${I18N.value.weekly} ${entry.weekdays.map(w => `周${WEEKDAY_SHORT[w - 1] ?? "?"}`).join("/")} ${entry.time}`
	}
}

// 时间戳 → datetime-local 字符串
const toDatetimeLocal = (timestamp: number): string => {
	const D = new Date(timestamp)
	const PAD = (n: number): string => String(n).padStart(2, "0")
	return `${D.getFullYear()}-${PAD(D.getMonth() + 1)}-${PAD(D.getDate())}T${PAD(D.getHours())}:${PAD(D.getMinutes())}`
}

// 从已有任务还原草稿 (同质 schedule 简单还原)
const draftFromTask = (task: TaskDefinition): TaskDraft => {
	const ENTRIES = task.schedule
	const HOURLY = ENTRIES.find(entry => entry.type === "hourly") as Extract<ScheduleEntry, {
		type: "hourly"
	}> | undefined
	const WEEKLY = ENTRIES.find(entry => entry.type === "weekly") as Extract<ScheduleEntry, {
		type: "weekly"
	}> | undefined
	const ONCE = ENTRIES.find(entry => entry.type === "once") as Extract<ScheduleEntry, { type: "once" }> | undefined
	const TIMES = [
		...new Set(
			ENTRIES
				.filter(entry => entry.type === "daily" || entry.type === "weekly")
				.map(entry => (entry as Extract<ScheduleEntry, { time: string }>).time),
		),
	]
	return {
		title: task.title,
		content: task.content,
		kind: task.kind,
		cycle: HOURLY ? "hourly" : WEEKLY ? "weekly" : "daily",
		minute: HOURLY?.minute ?? 0,
		weekdays: WEEKLY?.weekdays ?? [1, 2, 3, 4, 5],
		times: TIMES.length ? TIMES : ["09:00"],
		onceAt: ONCE ? toDatetimeLocal(ONCE.at * 1000) : "",
	}
}

// 先落盘未保存的草稿 (返回是否可继续)
const flushEditor = async (): Promise<boolean> => {
	if (!dirty.value) return true
	return await save()
}

// 打开新建
const openCreate = async (): Promise<void> => {
	if (!(await flushEditor())) return
	editingId.value = null
	const NEXT = defaultDraft()
	NEXT.onceAt = toDatetimeLocal(Date.now() + 3600_000) // 默认一小时后
	applyDraft(NEXT)
	editorOpen.value = true
}

// 打开编辑
const openEdit = async (task: TaskDefinition): Promise<void> => {
	if (editingId.value === task.id && !dirty.value) return
	if (!(await flushEditor())) return
	editingId.value = task.id
	applyDraft(draftFromTask(task))
	editorOpen.value = true
}

// 关闭编辑器
const closeEditor = (): void => {
	if (!saving.value) {
		editorOpen.value = false
		dirty.value = false
	}
}

// 星期多选
const toggleWeekday = (weekday: number): void => {
	draft.value.weekdays = draft.value.weekdays.includes(weekday)
		? draft.value.weekdays.filter(item => item !== weekday)
		: [...draft.value.weekdays, weekday]
	errors.value.weekdays = null
}

// 添加时间设定
const addTime = (): void => {
	draft.value.times = [...draft.value.times, "12:00"]
	errors.value.times = null
}

// 删除时间设定
const removeTime = (index: number): void => {
	draft.value.times = draft.value.times.filter((_, i) => i !== index)
}

// 草稿 → schedule JSON 数组
const buildSchedule = (): ScheduleEntry[] => {
	if (draft.value.kind === "once") {
		return [{type: "once", at: Math.floor(new Date(draft.value.onceAt).getTime() / 1000)}]
	}
	const TIMES = draft.value.times.map(time => time.trim()).filter(Boolean)
	switch (draft.value.cycle) {
		case "hourly":
			return [{type: "hourly", minute: draft.value.minute}]
		case "daily":
			return TIMES.map(time => ({type: "daily", time}))
		case "weekly":
			return TIMES.map(time => ({type: "weekly", weekdays: [...draft.value.weekdays], time}))
	}
}

// 保存
const save = async (): Promise<boolean> => {
	const NEXT_ERRORS: Record<string, string | null> = {}
	if (!draft.value.title.trim()) NEXT_ERRORS.name = I18N.value.nameEmpty
	if (!draft.value.content.trim()) NEXT_ERRORS.content = I18N.value.contentEmpty
	if (draft.value.kind === "once") {
		if (!draft.value.onceAt || Number.isNaN(new Date(draft.value.onceAt).getTime())) {
			NEXT_ERRORS.onceAt = I18N.value.onceTimeEmpty
		}
	} else if (draft.value.cycle === "hourly") {
		if (!Number.isInteger(draft.value.minute) || draft.value.minute < 0 || draft.value.minute > 59) {
			NEXT_ERRORS.minute = I18N.value.minuteInvalid
		}
	} else {
		if (draft.value.times.filter(time => time.trim()).length === 0) NEXT_ERRORS.times = I18N.value.timeEmpty
		if (draft.value.cycle === "weekly" && draft.value.weekdays.length === 0) NEXT_ERRORS.weekdays = I18N.value.weekdayEmpty
	}
	errors.value = NEXT_ERRORS
	if (Object.values(NEXT_ERRORS).some(Boolean)) return false

	const INPUT = {
		title: draft.value.title.trim(),
		content: draft.value.content.trim(),
		kind: draft.value.kind,
		schedule: buildSchedule(),
	}
	saving.value = true
	try {
		const RESULT = editingId.value === null
			? await createTask(INPUT)
			: await updateTask(editingId.value, INPUT)
		if (!RESULT) {
			showFeedback("error", I18N.value.saveFailed)
			return false
		}
		editorOpen.value = false
		dirty.value = false
		await STORE.refresh()
		showFeedback("ok", I18N.value.saved)
		return true
	} finally {
		saving.value = false
	}
}

// 切换启用
const toggleEnabled = async (task: TaskDefinition): Promise<void> => {
	const OK = await setTaskEnabled(task.id, !task.enabled)
	if (OK) await STORE.refresh()
}

// 删除
const doDelete = async (): Promise<void> => {
	const TARGET = deleteTarget.value
	if (!TARGET) return
	const OK = await deleteTask(TARGET.id)
	deleteTarget.value = null
	if (!OK) {
		showFeedback("error", I18N.value.saveFailed)
		return
	}
	await STORE.refresh()
}

onMounted(() => {
	void STORE.init()
	countdownTimer = setInterval(() => {
		nowTick.value = Date.now()
	}, 1000)
	GUARD.register({
		hasUnsaved: () => dirty.value,
		onSave: () => save(),
		title: I18N.value.unsavedTitle,
		message: I18N.value.unsavedMessage,
		saveLabel: I18N.value.saveAndLeave,
		discardLabel: I18N.value.discardLeave,
	})
})

onBeforeUnmount(() => {
	GUARD.unregister()
	if (countdownTimer) clearInterval(countdownTimer)
	if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<template>
	<section class="page-scheduled">
		<PageHeader :title="I18N.title" :subtitle="I18N.subtitle">
			<button class="btn-primary action-btn" @click="openCreate">
				<Icon name="add" :size="15"/>
				{{ I18N.newTask }}
			</button>
			<button class="refresh-btn" @click="STORE.refresh">
				<Icon name="refresh" :size="15"/>
				{{ I18N.refresh }}
			</button>
		</PageHeader>

		<div class="scheduled-body">
			<aside class="task-side" :class="{withEditor: editorOpen}">
				<SectionCard class="next-card" :title="I18N.nextTitle" icon="alarm-clock">
					<div class="next-grid">
						<div class="next-item">
							<span class="next-label">{{ I18N.nextTask }}</span>
							<span class="next-value">{{ STORE.nextTask?.task.title || I18N.nextEmpty }}</span>
						</div>
						<div class="next-item">
							<span class="next-label">{{ I18N.nextTime }}</span>
							<span class="next-value">
								{{ STORE.nextTask ? formatTime(STORE.nextTask.at) : I18N.nextEmpty }}
							</span>
						</div>
						<div class="next-item">
							<span class="next-label">{{ I18N.countdown }}</span>
							<span class="next-value countdown-value">{{ countdown ?? I18N.nextEmpty }}</span>
						</div>
					</div>
				</SectionCard>

				<div class="task-list">
					<EmptyState
						v-if="STORE.tasks.length === 0"
						icon="alarm-clock"
						:title="I18N.empty"
						:hint="I18N.emptyHint"
					/>
					<div
						v-for="task in STORE.tasks"
						:key="task.id"
						class="task-card"
						:class="{disabled: !task.enabled}"
						@click="openEdit(task)"
					>
						<div class="task-head">
							<span class="task-title">{{ task.title }}</span>
							<span class="task-kind" :class="task.kind">
								{{ task.kind === "once" ? I18N.once : I18N.permanent }}
							</span>
							<div class="task-actions">
								<button
									class="task-toggle"
									:class="{on: task.enabled}"
									@click.stop="toggleEnabled(task)"
								>
									<Icon :name="task.enabled ? 'check' : 'close'" :size="13"/>
									{{ task.enabled ? I18N.enabled : I18N.disabled }}
								</button>
								<button class="task-btn" @click.stop="openEdit(task)">
									<Icon name="settings" :size="13"/>
									{{ I18N.edit }}
								</button>
								<button class="task-btn danger" @click.stop="deleteTarget = task">
									<Icon name="close" :size="13"/>
									{{ I18N.delete }}
								</button>
							</div>
						</div>
						<p class="task-content">{{ task.content }}</p>
						<div class="task-schedule">
						<span v-for="(entry, index) in task.schedule" :key="index" class="schedule-chip">
							{{ formatEntry(entry) }}
						</span>
						</div>
					</div>
				</div>
			</aside>

			<div v-if="editorOpen" class="task-editor">
				<SectionCard scroll :title="editingId === null ? I18N.dialogCreate : I18N.dialogEdit">
					<template #actions>
						<span v-if="editingId !== null" class="editor-badge">
							{{ draft.kind === "once" ? I18N.once : I18N.permanent }}
						</span>
					</template>
					<div class="task-form">
						<FormField :label="I18N.name" :error="errors.name ?? undefined">
							<input
								v-model="draft.title"
								class="input"
								:class="{invalid: !!errors.name}"
								:placeholder="I18N.namePlaceholder"
								maxlength="60"
								@input="errors.name = null"
							/>
						</FormField>
						<FormField :label="I18N.content" :error="errors.content ?? undefined">
					<textarea
						v-model="draft.content"
						class="input textarea"
						rows="3"
						:placeholder="I18N.contentPlaceholder"
						maxlength="2000"
						@input="errors.content = null"
					/>
						</FormField>
						<FormField :label="I18N.kind">
							<div class="kind-switch">
								<button
									type="button"
									class="kind-option"
									:class="{active: draft.kind === 'permanent'}"
									@click="draft.kind = 'permanent'"
								>
									<span class="kind-name">{{ I18N.permanent }}</span>
									<span class="kind-desc">{{ I18N.permanentDesc }}</span>
								</button>
								<button
									type="button"
									class="kind-option"
									:class="{active: draft.kind === 'once'}"
									@click="draft.kind = 'once'"
								>
									<span class="kind-name">{{ I18N.once }}</span>
									<span class="kind-desc">{{ I18N.onceDesc }}</span>
								</button>
							</div>
						</FormField>

						<template v-if="draft.kind === 'once'">
							<FormField :label="I18N.onceTime" :error="errors.onceAt ?? undefined">
								<input
									v-model="draft.onceAt"
									type="datetime-local"
									class="input"
									:class="{invalid: !!errors.onceAt}"
									@input="errors.onceAt = null"
								/>
							</FormField>
						</template>
						<template v-else>
							<FormField :label="I18N.cycle">
								<select v-model="draft.cycle" class="input select">
									<option value="hourly">{{ I18N.hourly }}</option>
									<option value="daily">{{ I18N.daily }}</option>
									<option value="weekly">{{ I18N.weekly }}</option>
								</select>
							</FormField>
							<template v-if="draft.cycle === 'hourly'">
								<FormField
									:label="I18N.minute"
									:hint="I18N.minuteHint"
									:error="errors.minute ?? undefined"
								>
									<input
										v-model.number="draft.minute"
										type="number"
										min="0"
										max="59"
										class="input"
										:class="{invalid: !!errors.minute}"
										@input="errors.minute = null"
									/>
								</FormField>
							</template>
							<template v-else>
								<FormField
									v-if="draft.cycle === 'weekly'"
									:label="I18N.weekdays"
									:error="errors.weekdays ?? undefined"
								>
									<div class="weekday-picker">
										<button
											v-for="weekday in WEEKDAYS"
											:key="weekday.value"
											type="button"
											class="weekday-btn"
											:class="{on: draft.weekdays.includes(weekday.value)}"
											@click="toggleWeekday(weekday.value)"
										>
											{{ weekday.label }}
										</button>
									</div>
								</FormField>
								<FormField :label="I18N.timeList" :error="errors.times ?? undefined">
									<div class="time-list">
										<div v-for="(_time, index) in draft.times" :key="index" class="time-row">
											<input v-model="draft.times[index]" type="time" class="input"/>
											<button type="button" class="time-remove" @click="removeTime(index)">
												<Icon name="close" :size="13"/>
											</button>
										</div>
									</div>
									<button type="button" class="add-time-btn" @click="addTime">
										<Icon name="add" :size="13"/>
										{{ I18N.addTime }}
									</button>
								</FormField>
							</template>
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
			:message="deleteTarget ? I18N.deleteConfirmMessage(deleteTarget.title) : ''"
			:confirm-text="I18N.delete"
			danger
			@update:open="deleteTarget = null"
			@confirm="doDelete"
			@cancel="deleteTarget = null"
		/>

		<div v-if="feedback" class="task-feedback" :class="feedback.type">
			<Icon :name="feedback.type === 'ok' ? 'check' : 'error'" :size="14"/>
			{{ feedback.text }}
		</div>
	</section>
</template>

<style scoped lang="less">
.page-scheduled {
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

.scheduled-body {
	flex: 1;
	min-height: 0;
	display: flex;
	gap: 1rem;
}

.task-side {
	flex: 1;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;

	&.withEditor {
		flex: 0 0 32rem;
	}
}

.task-editor {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.task-editor :deep(.section-card) {
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

.next-card {
	flex-shrink: 0;
}

.next-grid {
	display: grid;
	grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
	gap: 1.2rem;

	.next-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;

		.next-label {
			font-size: 1.05rem;
			color: var(--text-muted);
		}

		.next-value {
			font-size: 1.35rem;
			font-weight: 600;
			color: var(--deep-teal-bright);
			text-shadow: 0 0 1rem var(--glow-teal-soft);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.countdown-value {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04rem;
	}
}

.task-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	padding-right: 0.2rem;
}

.task-card {
	padding: 1rem 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.7rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.02);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--line-strong);
	}

	&.disabled {
		opacity: 0.55;
	}

	.task-head {
		display: flex;
		align-items: center;
		gap: 0.8rem;

		.task-title {
			flex: 1;
			min-width: 0;
			font-size: 1.3rem;
			font-weight: 600;
			color: var(--text-primary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.task-kind {
			flex-shrink: 0;
			padding: 0.15rem 0.7rem;
			border-radius: 99.9rem;
			font-size: 0.95rem;
			font-weight: 600;

			&.permanent {
				color: var(--deep-teal-bright);
				background-color: rgba(125, 227, 255, 0.1);
				border: 0.1rem solid var(--line-strong);
			}

			&.once {
				color: var(--warning);
				background-color: rgba(241, 178, 74, 0.1);
				border: 0.1rem solid rgba(241, 178, 74, 0.35);
			}
		}

		.task-actions {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
	}

	.task-content {
		margin: 0;
		font-size: 1.15rem;
		line-height: 1.6;
		color: var(--text-body);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.task-schedule {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.schedule-chip {
		padding: 0.2rem 0.8rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: 99.9rem;
		font-size: 1.05rem;
		color: var(--text-faint);
		background-color: rgba(125, 227, 255, 0.05);
	}
}

.task-toggle {
	padding: 0.3rem 0.8rem;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
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

.task-btn {
	padding: 0.3rem 0.8rem;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	border: 0.1rem solid transparent;
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--text-muted);
	font-family: inherit;
	font-size: 1rem;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal-soft);
		color: var(--deep-teal-bright);
	}

	&.danger:hover {
		border-color: rgba(251, 44, 54, 0.45);
		color: var(--danger);
		background-color: rgba(251, 44, 54, 0.08);
	}
}

.task-form {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.kind-switch {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.8rem;

	.kind-option {
		padding: 0.8rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: var(--radius-sm);
		background-color: rgba(255, 255, 255, 0.03);
		color: var(--text-muted);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s ease;

		.kind-name {
			font-size: 1.2rem;
			font-weight: 600;
			color: var(--text-body);
		}

		.kind-desc {
			font-size: 0.95rem;
			line-height: 1.5;
			color: var(--text-faint);
		}

		&.active {
			border-color: var(--deep-teal);
			background-color: rgba(125, 227, 255, 0.08);
			box-shadow: 0 0 0.8rem var(--glow-teal-soft);

			.kind-name {
				color: var(--deep-teal-bright);
			}
		}
	}
}

.weekday-picker {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;

	.weekday-btn {
		width: 3.4rem;
		height: 2.6rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: var(--radius-sm);
		background-color: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			border-color: var(--deep-teal-soft);
			color: var(--text-primary);
		}

		&.on {
			border-color: var(--deep-teal);
			color: var(--ink-deep);
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
		}
	}
}

.time-list {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;

	.time-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;

		.input {
			flex: 1;
		}

		.time-remove {
			width: 2.6rem;
			height: 2.6rem;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0.1rem solid transparent;
			border-radius: var(--radius-sm);
			background-color: transparent;
			color: var(--text-muted);
			cursor: pointer;
			transition: all 0.2s ease;

			&:hover {
				color: var(--danger);
				border-color: rgba(251, 44, 54, 0.4);
			}
		}
	}
}

.add-time-btn {
	align-self: flex-start;
	padding: 0.45rem 1rem;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	border: 0.1rem dashed var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--deep-teal-soft);
	font-family: inherit;
	font-size: 1.05rem;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal);
		color: var(--deep-teal-bright);
		background-color: rgba(125, 227, 255, 0.06);
	}
}

.task-feedback {
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
