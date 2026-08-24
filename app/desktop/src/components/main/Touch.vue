<script setup lang="ts">
import {computed, onMounted, onBeforeUnmount, ref, watch} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {logger} from "../../services/logger"
import {useLive2DStore} from "../../services/store/live2d.ts"
import type {TouchArea, TouchType} from "../../services/store/touch.ts"
import Icon from "../common/Icon.vue"
import ConfirmDialog from "../common/ConfirmDialog.vue"

const I18N = computed(() => useLanguages().components.main.touch)

const L2D = useLive2DStore()

// 触摸区域画布
const canvas = ref<HTMLCanvasElement | null>(null)

// 草稿触摸区域
const draft = ref<{ x: number, y: number, w: number, h: number } | null>(null)

// 编辑触摸触摸区域
const editing = ref<TouchArea | null>(null)

// 编辑触摸触摸区域索引
const editingIndex = ref(-1)

// 编辑触摸触摸区域名称
const editName = ref("")

// 编辑触摸触摸区域类型
const editType = ref<TouchType>("tap")

// 编辑触摸触摸区域提示词
const editPrompt = ref("")

// 请求动画帧
let raf = 0

// 触摸区域编辑模式
let mode: "idle" | "draw" | "move" = "idle"

// 当前触摸指针 ID
let pointerId = -1

// 触摸区域编辑起始点
let start = {x: 0, y: 0}

// 触摸区域编辑原始点
let origin = {x: 0, y: 0}

// 当前移动触摸触摸区域 ID
let movingId: string | null = null

// 是否正在移动草稿触摸区域
let movingDraft = false

// 计算触摸区域编辑起始点和原始点
const contain = (sw: number, sh: number, w: number, h: number) => {
	if (!sw || !sh || !w || !h) return null
	const S = Math.min(w / sw, h / sh)
	return {dw: sw * S, dh: sh * S, ox: (w - sw * S) / 2, oy: (h - sh * S) / 2}
}

// 计算触摸区域编辑起始点和原始点
const point = (e: PointerEvent) => {
	const EL = canvas.value
	if (!EL) return {x: 0, y: 0}
	const R = EL.getBoundingClientRect()
	const SRC = L2D.canvas
	const PX = Math.max(0, Math.min(R.width, e.clientX - R.left))
	const PY = Math.max(0, Math.min(R.height, e.clientY - R.top))
	if (SRC?.width && SRC?.height) {
		const C = contain(SRC.width, SRC.height, R.width, R.height)
		if (C) {
			return {
				x: Math.max(0, Math.min(1, (PX - C.ox) / C.dw)),
				y: Math.max(0, Math.min(1, (PY - C.oy) / C.dh))
			}
		}
	}
	return {x: PX / R.width, y: PY / R.height}
}

// 计算触摸区域编辑起始点和原始点
const style = (t: { x: number, y: number, w: number, h: number }) => {
	const EL = canvas.value
	const SRC = L2D.canvas
	if (!EL || !SRC?.width || !SRC?.height) return {}
	const R = EL.getBoundingClientRect()
	const C = contain(SRC.width, SRC.height, R.width, R.height)
	if (!C) return {}
	return {
		left: `${(C.ox + t.x * C.dw) / R.width * 100}%`,
		top: `${(C.oy + t.y * C.dh) / R.height * 100}%`,
		width: `${t.w * C.dw / R.width * 100}%`,
		height: `${t.h * C.dh / R.height * 100}%`
	}
}

// 判断触摸点是否在触摸区域内
const contains = (p: { x: number, y: number }, t: {
	x: number,
	y: number,
	w: number,
	h: number
}) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h

// 查找触摸点所属触摸触摸区域
const hit = (p: { x: number, y: number }) => {
	for (let i = L2D.touches.length - 1; i >= 0; i--) {
		const T = L2D.touches[i]
		if (contains(p, T)) return T
	}
	return null
}

// 重置触摸指针
const resetPointer = () => {
	mode = "idle"
	pointerId = -1
	movingId = null
	movingDraft = false
}

// 触摸指针按下事件
const down = (e: PointerEvent) => {
	if (mode !== "idle") return
	const EL = e.currentTarget as HTMLElement
	const P = point(e)
	const T = hit(P)
	pointerId = e.pointerId
	EL.setPointerCapture(e.pointerId)
	if (draft.value && contains(P, draft.value)) {
		mode = "move"
		movingDraft = true
		start = P
		origin = {x: draft.value.x, y: draft.value.y}
		return
	}
	if (T) {
		if (editing.value?.id === T.id) {
			mode = "move"
			movingId = T.id
			start = P
			origin = {x: T.x, y: T.y}
			return
		}
		resetPointer()
		return
	}
	if (draft.value) {
		resetPointer()
		return
	}
	mode = "draw"
	start = P
	draft.value = {x: P.x, y: P.y, w: 0, h: 0}
}

// 触摸指针移动事件
const move = (e: PointerEvent) => {
	if (e.pointerId !== pointerId) return
	const P = point(e)
	if (mode === "move") {
		if (movingDraft && draft.value) {
			draft.value.x = Math.max(0, Math.min(1 - draft.value.w, origin.x + P.x - start.x))
			draft.value.y = Math.max(0, Math.min(1 - draft.value.h, origin.y + P.y - start.y))
			return
		}
		if (movingId) {
			const T = L2D.touches.find(v => v.id === movingId)
			if (!T) return
			L2D.moveTouch(T.id, {
				x: Math.max(0, Math.min(1 - T.w, origin.x + P.x - start.x)),
				y: Math.max(0, Math.min(1 - T.h, origin.y + P.y - start.y))
			})
		}
		return
	}
	if (mode === "draw") {
		draft.value = {
			x: Math.min(start.x, P.x),
			y: Math.min(start.y, P.y),
			w: Math.abs(P.x - start.x),
			h: Math.abs(P.y - start.y)
		}
	}
}

// 触摸指针松开事件
const up = async (e: PointerEvent) => {
	if (e.pointerId !== pointerId) return
	const EL = e.currentTarget as HTMLElement
	if (EL.hasPointerCapture(e.pointerId)) EL.releasePointerCapture(e.pointerId)
	if (mode === "move") {
		if (movingId) await L2D.saveConfig()
		resetPointer()
		return
	}
	if (mode === "draw" && draft.value) {
		if (draft.value.w < 0.03 || draft.value.h < 0.03) {
			draft.value = null
			resetPointer()
			return
		}
		if (editing.value && editing.value.id === "" && editingIndex.value < 0) {
			editing.value = {
				...editing.value,
				x: draft.value.x,
				y: draft.value.y,
				w: draft.value.w,
				h: draft.value.h
			}
		} else {
			editName.value = I18N.value.defaultName(L2D.touches.length + 1)
			editType.value = "tap"
			editPrompt.value = ""
			editing.value = {
				id: "",
				name: editName.value,
				type: "tap",
				x: draft.value.x,
				y: draft.value.y,
				w: draft.value.w,
				h: draft.value.h,
				prompt: ""
			}
			editingIndex.value = -1
		}
	}
	resetPointer()
}

// 重绘制触摸区域
const redraw = () => {
	draft.value = null
	mode = "idle"
	pointerId = -1
	movingId = null
	movingDraft = false
}

// 渲染触摸区域
const render = () => {
	raf = requestAnimationFrame(render)
	const DST = canvas.value
	const SRC = L2D.canvas
	if (!DST || !SRC) return
	const CTX = DST.getContext("2d")
	if (!CTX) return
	const DPR = devicePixelRatio || 1
	const W = Math.round(DST.clientWidth * DPR)
	const H = Math.round(DST.clientHeight * DPR)
	if (DST.width !== W || DST.height !== H) {
		DST.width = W
		DST.height = H
	}
	CTX.clearRect(0, 0, W, H)
	if (!SRC.width || !SRC.height) return
	const C = contain(SRC.width, SRC.height, W, H)
	if (C) CTX.drawImage(SRC, C.ox, C.oy, C.dw, C.dh)
}

// 开始编辑触摸区域
const startEdit = (t: TouchArea, i: number) => {
	draft.value = null
	editing.value = t
	editingIndex.value = i
	editName.value = t.name
	editType.value = t.type
	editPrompt.value = t.prompt
}

// 确认编辑触摸区域
const confirmEdit = async () => {
	if (!editing.value) return
	const NAME = editName.value.trim() || I18N.value.untitled
	if (editingIndex.value < 0) {
		await L2D.addTouch({
			name: NAME,
			type: editType.value,
			x: editing.value.x,
			y: editing.value.y,
			w: editing.value.w,
			h: editing.value.h
		})
		await logger.info(`添加触摸区域: ${NAME}`)
	} else {
		await L2D.updateTouch(editing.value.id, {
			name: NAME,
			type: editType.value,
			prompt: editPrompt.value
		})
		await logger.info(`更新触摸区域: ${NAME}`)
	}
	editing.value = null
	editingIndex.value = -1
	draft.value = null
}

// 取消编辑触摸区域: 放弃草稿并清空表单, 完全退出编辑
const cancelEdit = () => {
	editing.value = null
	editingIndex.value = -1
	draft.value = null
	editName.value = ""
	editType.value = "tap"
	editPrompt.value = ""
}

// 待删除的触摸区域 (二次确认弹窗确认后执行)
const pendingRemove = ref<TouchArea | null>(null)

// 删除触摸区域二次确认弹窗
const showRemoveConfirm = ref(false)

// 请求删除触摸区域 (打开确认弹窗)
const remove = (t: TouchArea) => {
	pendingRemove.value = t
	showRemoveConfirm.value = true
}

// 确认删除触摸区域
const doRemove = async () => {
	const T = pendingRemove.value
	pendingRemove.value = null
	showRemoveConfirm.value = false
	if (!T) return
	await L2D.removeTouch(T.id)
	await logger.info(`删除触摸区域: ${T.name}`)
}

onMounted(() => {
	raf = requestAnimationFrame(render)
})

onBeforeUnmount(() => {
	cancelAnimationFrame(raf)
})

watch(() => L2D.currentModel, async m => {
	if (m) await L2D.loadConfig(m)
}, {immediate: true})
</script>

<template>
	<section class="page-touch">
		<header class="touch-head">
			<div>
				<h2 class="touch-title">
					{{ I18N.title }}
					<span v-if="L2D.currentModel" class="touch-model">{{ L2D.currentModel }}</span>
				</h2>
				<p class="touch-sub">{{ I18N.subtitle }}</p>
			</div>
		</header>
		<div class="touch-body">
			<div class="touch-left">
				<div
					class="touch-canvas"
					:class="{locked: !!draft}"
					@pointerdown="down"
					@pointermove="move"
					@pointerup="up"
					@pointercancel="up"
				>
					<canvas ref="canvas" class="touch-model-preview"/>
					<div
						v-for="t in L2D.touches"
						:key="t.id"
						class="touch-box saved"
						:class="t.type"
						:style="style(t)"
					>
						{{ t.name }}
					</div>
					<div v-if="draft" class="touch-box draft locked" :style="style(draft)">
						{{ editing?.name || I18N.draftLabel }}
					</div>
					<span v-if="!L2D.isInitialized" class="touch-hint">{{ I18N.loadingModel }}</span>
				</div>
			</div>
			<aside class="touch-right">
				<ul v-if="L2D.touches.length" class="touch-list">
					<li v-for="(t, i) in L2D.touches" :key="t.id" class="touch-item">
						<span class="touch-item-type" :class="t.type">
							{{t.type === "tap" ? I18N.typeTap : t.type === "swipe" ? I18N.typeSwipe : I18N.typeFrenzy}}
						</span>
						<span class="touch-item-name">{{ t.name }}</span>
						<span class="touch-item-size">
							({{ (t.w * 100).toFixed(0) }}% × {{ (t.h * 100).toFixed(0) }}%)
						</span>
						<div class="touch-item-actions">
							<button class="mini-btn" @click="startEdit(t, i)">
								<Icon name="settings" :size="13"/>
							</button>
							<button class="mini-btn danger" @click="remove(t)">
								<Icon name="close" :size="13"/>
							</button>
						</div>
					</li>
				</ul>
				<p v-else class="touch-empty">{{ I18N.empty }}</p>
				<div v-if="editing" class="touch-editor">
					<div class="editor-label">{{ I18N.name }}</div>
					<input v-model="editName" class="editor-input" :placeholder="I18N.namePlaceholder">
					<div class="editor-label">{{ I18N.type }}</div>
					<div class="editor-types">
						<button
							v-for="type in ['tap', 'swipe', 'frenzy'] as TouchType[]"
							:key="type"
							type="button"
							class="type-pill"
							:class="{active: editType === type}"
							@click="editType = type"
						>
							{{ type === "tap" ? I18N.typeTap : type === "swipe" ? I18N.typeSwipe : I18N.typeFrenzy }}
						</button>
					</div>
					<div class="editor-label">{{ I18N.prompt }}</div>
					<input v-model="editPrompt" class="editor-input" :placeholder="I18N.promptPlaceholder">
					<div class="editor-actions">
						<button class="exc-btn" @click="cancelEdit">
							<Icon name="close" :size="14"/>
							<span>{{ I18N.cancel }}</span>
						</button>
						<button v-if="draft" class="exc-btn redraw" @click="redraw">
							<Icon name="refresh" :size="14"/>
							<span>{{ I18N.redraw }}</span>
						</button>
						<button class="exc-btn done" @click="confirmEdit">
							<Icon name="check" :size="14"/>
							<span>{{ editingIndex < 0 ? I18N.add : I18N.save }}</span>
						</button>
					</div>
				</div>
			</aside>
		</div>
		<ConfirmDialog
			v-model:open="showRemoveConfirm"
			:title="I18N.deleteConfirmTitle"
			:message="I18N.deleteConfirmMessage(pendingRemove?.name || '')"
			:confirm-text="I18N.delete"
			danger
			@confirm="doRemove"
		/>
	</section>
</template>

<style scoped lang="less">
.page-touch {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	overflow: hidden;
}

.touch-body {
	flex: 1;
	min-height: 0;
	width: 100%;
	display: flex;
	gap: 1rem;
}

.touch-left {
	flex: 1;
	width: 0;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.touch-right {
	width: 30rem;
	flex-shrink: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	overflow: hidden;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	padding: 0.8rem;
	background-color: rgba(255, 255, 255, 0.03);
}

.touch-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-shrink: 0;

	.touch-title {
		font-size: 1.8rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: 0 0 1.8rem var(--glow-teal), 0 0 6rem var(--glow-teal-soft);
	}

	.touch-model {
		padding: 0.15rem 0.7rem;
		display: inline-block;
		font-size: 1.2rem;
		color: var(--deep-teal-bright);
		background-color: rgba(125, 227, 255, 0.1);
		border: 0.1rem solid color-mix(in srgb, var(--deep-teal) 45%, transparent);
		border-radius: 0.5rem;
	}

	.touch-sub {
		margin-top: 0.4rem;
		font-size: 1.2rem;
		color: var(--text-muted);
	}
}

.touch-canvas {
	position: relative;
	flex: 1;
	min-height: 0;
	width: 100%;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background: repeating-linear-gradient(0deg, transparent, transparent 9.5%, rgba(125, 227, 255, 0.05) 10%), repeating-linear-gradient(90deg, transparent, transparent 9.5%, rgba(125, 227, 255, 0.05) 10%), rgba(0, 0, 0, 0.25);
	overflow: hidden;
	touch-action: none;
	cursor: crosshair;

	&.locked {
		cursor: default;
	}
}

.touch-model-preview {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	display: block;
	pointer-events: none;
}

.touch-box {
	position: absolute;
	box-sizing: border-box;
	border: 0.2rem solid var(--touch-tap);
	background-color: color-mix(in srgb, var(--touch-tap) 18%, transparent);
	border-radius: 0.3rem;
	font-size: 1rem;
	line-height: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--text-primary);
	text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	pointer-events: none;

	&.swipe {
		border-color: var(--touch-swipe);
		background-color: color-mix(in srgb, var(--touch-swipe) 18%, transparent);
	}

	&.frenzy {
		border-color: var(--touch-frenzy);
		background-color: color-mix(in srgb, var(--touch-frenzy) 18%, transparent);
	}

	&.draft {
		border-style: dashed;
		border-color: var(--touch-draft);
		background-color: color-mix(in srgb, var(--touch-draft) 22%, transparent);

		&.locked {
			border-style: solid;
			box-shadow: 0 0 1rem var(--glow-teal-soft);
		}
	}
}

.touch-hint {
	position: absolute;
	left: 50%;
	top: 38%;
	transform: translate(-50%, -50%);
	color: var(--text-muted);
	font-size: 1.1rem;
	pointer-events: none;
	text-align: center;
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}

.touch-editor {
	padding: 0.8rem 1rem;
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
}

.editor-label {
	font-size: 1.05rem;
	color: var(--text-muted);
}

.editor-input {
	padding: 0.5rem 0.7rem;
	width: 100%;
	box-sizing: border-box;
	border-radius: var(--radius-sm);
	border: 0.1rem solid var(--line-strong);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-primary);
	font: inherit;
	font-size: 1.15rem;
	outline: none;
	transition: border-color 0.2s ease, box-shadow 0.2s ease;

	&::placeholder {
		color: var(--text-faint);
	}

	&:focus {
		border-color: var(--deep-teal-soft);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}
}

.editor-types {
	display: flex;
	gap: 0.6rem;
}

.type-pill {
	padding: 0.4rem 0.8rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: 0.7rem;
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-muted);
	font: inherit;
	font-size: 1.1rem;
	cursor: pointer;
	user-select: none;
	transition: all 0.18s ease;

	&:hover {
		color: var(--text-primary);
		background-color: rgba(125, 227, 255, 0.08);
	}

	&.active {
		color: var(--ink-deep);
		background-color: var(--deep-teal-bright);
		border-color: var(--deep-teal);
		font-weight: 600;
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}
}

.editor-actions {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	margin-top: 0.2rem;
}

.exc-btn {
	padding: 0.55rem 1.1rem;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.08);
	color: var(--deep-teal-bright);
	font: inherit;
	font-size: 1.1rem;
	cursor: pointer;
	transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;

	&:hover {
		filter: brightness(1.15);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	&.done {
		background-color: color-mix(in srgb, var(--touch-ok) 18%, transparent);
		color: var(--touch-ok);
	}

	&.redraw {
		background-color: rgba(255, 170, 60, 0.1);
		color: var(--warning, #f1b24a);
		border-color: rgba(255, 170, 60, 0.35);

		&:hover {
			filter: brightness(1.1);
			box-shadow: 0 0 0.8rem rgba(255, 170, 60, 0.25);
		}
	}
}

.touch-list {
	padding: 0;
	margin: 0;
	list-style: none;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.touch-item {
	padding: 0.5rem 0.8rem;
	display: flex;
	align-items: center;
	gap: 0.7rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);
	flex-shrink: 0;

	.touch-item-type {
		padding: 0.15rem 0.5rem;
		font-size: 0.9rem;
		border-radius: 0.5rem;
		background-color: color-mix(in srgb, var(--touch-tap) 20%, transparent);
		color: var(--touch-tap-ink);

		&.swipe {
			background-color: color-mix(in srgb, var(--touch-swipe) 20%, transparent);
			color: var(--touch-swipe-ink);
		}

		&.frenzy {
			background-color: color-mix(in srgb, var(--touch-frenzy) 22%, transparent);
			color: var(--touch-frenzy-ink);
		}
	}

	.touch-item-name {
		flex: 1;
		font-size: 1.2rem;
		color: var(--text-primary);
	}

	.touch-item-size {
		font-size: 0.9rem;
		color: var(--text-muted);
	}

	.touch-item-actions {
		display: flex;
		gap: 0.4rem;
	}
}

.mini-btn {
	width: 2.2rem;
	height: 2.2rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--text-muted);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(255, 255, 255, 0.08);
	}

	&.danger {
		color: var(--danger);

		&:hover {
			background-color: rgba(251, 44, 54, 0.12);
			border-color: var(--danger);
		}
	}
}

.touch-empty {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--text-muted);
	font-size: 1.1rem;
	text-align: center;
	line-height: 1.8;
}
</style>
