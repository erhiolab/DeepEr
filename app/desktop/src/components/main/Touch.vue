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

const canvas = ref<HTMLCanvasElement | null>(null)

// 窗口/容器尺寸变化触发重渲染的计数器
// 选区位置是"绝对定位 + 基于容器尺寸算出的百分比", 依赖 DOM 尺寸(非响应式)。
// 用 ResizeObserver 监听容器尺寸, 变化时自增该值, 让选区随窗口宽高动态重算, 避免变形/对不上。
const sizeTick = ref(0)
let resizeObserver: ResizeObserver | null = null

/**
 * 编辑状态
 *
 * idle      : 空闲, 可以新建或选择区域
 * drawing   : 正在绘制新区域
 * new       : 新区域已经绘制完成, 正在填写表单
 * editing   : 正在编辑已有区域
 * moving    : 移动区域
 * resizing  : 调整区域大小
 */
type Mode = "idle" | "drawing" | "new" | "editing" | "moving" | "resizing"
let mode: Mode = "idle"

// 新建区域草稿
const draft = ref<{
	x: number
	y: number
	w: number
	h: number
} | null>(null)

// 当前编辑中的已有区域
const editing = ref<TouchArea | null>(null)

// 编辑区域表单
const editName = ref("")
const editType = ref<TouchType>("tap")
const editPrompt = ref("")

let raf = 0

let pointerId = -1

let start = {x: 0, y: 0}

// 当前拖动开始时的区域左上角
let origin = {x: 0, y: 0}

// 当前调整大小开始时的区域矩形
let resizeOrigin = {
	x: 0,
	y: 0,
	w: 0,
	h: 0
}

// 调整大小句柄
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
type Handle = typeof HANDLES[number]

// 调整大小句柄轴向
const HANDLE_AXIS: Record<Handle, { sx: number, sy: number }> = {
	nw: {sx: 0, sy: 0},
	n: {sx: 0.5, sy: 0},
	ne: {sx: 1, sy: 0},
	e: {sx: 1, sy: 0.5},
	se: {sx: 1, sy: 1},
	s: {sx: 0.5, sy: 1},
	sw: {sx: 0, sy: 1},
	w: {sx: 0, sy: 0.5}
}

// 当前调整大小句柄
let resizeHandle: Handle | null = null

// 当前悬停的句柄
const hovering = ref<Handle | null>(null)

// Live2D contain
const contain = (sw: number, sh: number, w: number, h: number) => {
	if (!sw || !sh || !w || !h) return null
	const S = Math.min(w / sw, h / sh)
	return {
		dw: sw * S,
		dh: sh * S,
		ox: (w - sw * S) / 2,
		oy: (h - sh * S) / 2
	}
}

// 鼠标 / Pointer 坐标转换到 Live2D 逻辑坐标
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
	return {
		x: PX / R.width,
		y: PY / R.height
	}
}

// 逻辑坐标 -> CSS 坐标
const style = (t: { x: number, y: number, w: number, h: number }) => {
	const EL = canvas.value
	const SRC = L2D.canvas
	if (!EL || !SRC?.width || !SRC?.height) return {}
	// 读取尺寸版本号, 建立响应式依赖, 窗口/容器尺寸变化时此处随 sizeTick 重算
	void sizeTick.value
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

// 获取逻辑坐标对应的布局信息
const layout = () => {
	const EL = canvas.value
	const SRC = L2D.canvas
	if (!EL || !SRC?.width || !SRC?.height) return null
	// 建立尺寸响应式依赖, 随窗口/容器变化重算
	void sizeTick.value
	const R = EL.getBoundingClientRect()
	const C = contain(SRC.width, SRC.height, R.width, R.height)
	if (!C) return null
	return {
		left: (x: number) => (C.ox + x * C.dw) / R.width * 100,
		top: (y: number) => (C.oy + y * C.dh) / R.height * 100,
		perX: C.dw,
		perY: C.dh
	}
}

// 当前正在编辑 / 新建的区域
const activeRect = computed(() => {
	if (draft.value) return draft.value
	if (editing.value) return editing.value
	return null
})

// 当前需要显示 8 个手柄的区域
const targetRect = computed(() => activeRect.value)

// 判断点是否在区域内部
const contains = (
	p: { x: number, y: number },
	t: { x: number, y: number, w: number, h: number }
) => {
	return (
		p.x >= t.x &&
		p.x <= t.x + t.w &&
		p.y >= t.y &&
		p.y <= t.y + t.h
	)
}

// 查找鼠标下方的已保存区域
const hit = (p: { x: number, y: number }) => {
	for (let i = L2D.touches.length - 1; i >= 0; i--) {
		const T = L2D.touches[i]
		if (contains(p, T)) {
			return T
		}
	}
	return null
}

// 手柄所在位置
const handleStyle = (
	t: { x: number, y: number, w: number, h: number },
	handle: Handle
) => {
	const L = layout()
	if (!L) return {}
	const A = HANDLE_AXIS[handle]
	const cx = t.x + A.sx * t.w
	const cy = t.y + A.sy * t.h
	return {
		left: `${L.left(cx)}%`,
		top: `${L.top(cy)}%`
	}
}

// 判断鼠标是否命中 8 个手柄
const hitHandle = (
	rect: { x: number, y: number, w: number, h: number },
	p: { x: number, y: number }
) => {
	const L = layout()
	if (!L) return null
	const EDGE = 20
	if (
		p.x < rect.x - EDGE / L.perX ||
		p.x > rect.x + rect.w + EDGE / L.perX ||
		p.y < rect.y - EDGE / L.perY ||
		p.y > rect.y + rect.h + EDGE / L.perY
	) {
		return null
	}
	const dL = (p.x - rect.x) * L.perX
	const dR = (rect.x + rect.w - p.x) * L.perX
	const dT = (p.y - rect.y) * L.perY
	const dB = (rect.y + rect.h - p.y) * L.perY
	const minH = Math.min(dL, dR)
	const minV = Math.min(dT, dB)
	if (minH >= EDGE && minV >= EDGE) return null
	let best: Handle | null = null
	let bestDist = Infinity
	for (const H of HANDLES) {
		const A = HANDLE_AXIS[H]
		const CX = rect.x + A.sx * rect.w
		const CY = rect.y + A.sy * rect.h
		const DX = (CX - p.x) * L.perX
		const DY = (CY - p.y) * L.perY
		const DIST = DX * DX + DY * DY
		if (DIST < bestDist) {
			bestDist = DIST
			best = H
		}
	}
	return best
}

// 当前 hover 到哪个手柄
const updateHover = (e: PointerEvent) => {
	if (mode !== "idle" && mode !== "new" && mode !== "editing") {
		hovering.value = null
		return
	}
	const RECT = activeRect.value
	if (!RECT) {
		hovering.value = null
		return
	}
	hovering.value = hitHandle(RECT, point(e))
}

// 重置 pointer 状态, 回到对应的基础状态
const resetPointer = () => {
	mode = draft.value ? "new" : editing.value ? "editing" : "idle"
	pointerId = -1
	resizeHandle = null
}

// 开始编辑已有区域
const startEdit = (t: TouchArea) => {
	// 新建或正在编辑时禁止切换
	if (mode === "drawing" || mode === "new" || mode === "editing") return
	draft.value = null
	editing.value = {...t}
	editName.value = t.name
	editType.value = t.type
	editPrompt.value = t.prompt
	mode = "editing"
}

// 开始绘制新区域
const startDrawing = (e: PointerEvent) => {
	// 编辑状态下直接拒绝
	if (mode !== "idle") return
	const P = point(e)
	draft.value = {
		x: P.x,
		y: P.y,
		w: 0,
		h: 0
	}
	// 初始化表单(若为空才给默认名, 以便"重新绘制"后能保留已填内容)
	if (!editName.value.trim()) editName.value = I18N.value.defaultName(L2D.touches.length + 1)
	editType.value = editType.value || "tap"
	editPrompt.value = editPrompt.value || ""
	mode = "drawing"
	start = P
}

// Pointer Down
const down = (e: PointerEvent) => {
	// 新建或正在编辑时禁止切换
	if (mode === "drawing" || mode === "moving" || mode === "resizing") return
	const EL = e.currentTarget as HTMLElement
	const P = point(e)
	hovering.value = null
	// 新建完成后的状态, 允许继续调整刚刚绘制的区域, 但不能编辑其他区域, 也不能新建第二个区域
	if (mode === "new" && draft.value) {
		const H = hitHandle(draft.value, P)
		if (H) {
			pointerId = e.pointerId
			EL.setPointerCapture(e.pointerId)
			mode = "resizing"
			resizeHandle = H
			resizeOrigin = {...draft.value}
			start = P
			return
		}
		if (contains(P, draft.value)) {
			pointerId = e.pointerId
			EL.setPointerCapture(e.pointerId)
			mode = "moving"
			origin = {
				x: draft.value.x,
				y: draft.value.y
			}
			start = P
			return
		}
		return
	}
	// 编辑已有区域
	if (mode === "editing" && editing.value) {
		const H = hitHandle(editing.value, P)
		if (H) {
			pointerId = e.pointerId
			EL.setPointerCapture(e.pointerId)
			mode = "resizing"
			resizeHandle = H
			resizeOrigin = {...editing.value}
			start = P
			return
		}
		if (contains(P, editing.value)) {
			pointerId = e.pointerId
			EL.setPointerCapture(e.pointerId)
			mode = "moving"
			origin = {
				x: editing.value.x,
				y: editing.value.y
			}
			start = P
			return
		}
		return
	}
	// idle 状态, 点击已有区域 -> 编辑. 点击空白区域 -> 新建
	if (mode !== "idle") return
	const T = hit(P)
	if (T) {
		startEdit(T)
		return
	}
	// 新建: 记录指针并捕获, 保证 move/up 能更新草稿并进入 new
	pointerId = e.pointerId
	EL.setPointerCapture(e.pointerId)
	startDrawing(e)
}

// Pointer Move
const move = (e: PointerEvent) => {
	if (e.pointerId !== pointerId) {
		updateHover(e)
		return
	}
	const P = point(e)
	// 调整大小
	if (mode === "resizing") {
		if (!resizeHandle) return
		const A = HANDLE_AXIS[resizeHandle]
		const ORIG = resizeOrigin
		const MIN = 0.02
		const NX = ORIG.x + A.sx * ORIG.w + (P.x - start.x)
		const NY = ORIG.y + A.sy * ORIG.h + (P.y - start.y)
		let left = ORIG.x
		let right = ORIG.x + ORIG.w
		let top = ORIG.y
		let bottom = ORIG.y + ORIG.h
		if (A.sx < 0.5) {
			left = NX
		} else if (A.sx > 0.5) {
			right = NX
		}
		if (A.sy < 0.5) {
			top = NY
		} else if (A.sy > 0.5) {
			bottom = NY
		}
		let x = left
		let y = top
		let w = right - left
		let h = bottom - top
		if (w < MIN) {
			x = right - MIN
			w = MIN
		}
		if (h < MIN) {
			y = bottom - MIN
			h = MIN
		}
		x = Math.max(0, Math.min(1 - w, x))
		y = Math.max(0, Math.min(1 - h, y))
		const NEXT = {x, y, w, h}
		if (draft.value) {
			draft.value = {
				...draft.value,
				...NEXT
			}
		} else if (editing.value) {
			editing.value = {
				...editing.value,
				...NEXT
			}
		}
		return
	}
	// 移动
	if (mode === "moving") {
		const SIZE = draft.value ? draft.value : editing.value
		const X = Math.max(0, Math.min(1 - (SIZE?.w ?? 0), origin.x + P.x - start.x))
		const Y = Math.max(0, Math.min(1 - (SIZE?.h ?? 0), origin.y + P.y - start.y))
		if (draft.value) {
			draft.value = {...draft.value, x: X, y: Y}
		} else if (editing.value) {
			editing.value = {...editing.value, x: X, y: Y}
		}
		return
	}
	// 新建区域绘制
	if (mode === "drawing" && draft.value) {
		draft.value = {
			x: Math.min(start.x, P.x),
			y: Math.min(start.y, P.y),
			w: Math.abs(P.x - start.x),
			h: Math.abs(P.y - start.y)
		}
	}
}

// Pointer Up
const up = (e: PointerEvent) => {
	if (e.pointerId !== pointerId) return
	const EL = e.currentTarget as HTMLElement
	if (EL.hasPointerCapture(e.pointerId)) EL.releasePointerCapture(e.pointerId)
	// 绘制完成
	if (mode === "drawing") {
		if (!draft.value || draft.value.w < 0.03 || draft.value.h < 0.03) {
			draft.value = null
			mode = "idle"
			pointerId = -1
			return
		}
		// drawing -> new: 区域与表单已存在, 禁止编辑其他区域/禁止再新建
		mode = "new"
		pointerId = -1
		return
	}
	if (mode === "moving" || mode === "resizing") {
		resetPointer()
		return
	}
	pointerId = -1
}

// 重新绘制
const redraw = () => {
	if (mode !== "new") return
	draft.value = null
	mode = "idle"
}

// 保存, 新建 -> addTouch; 编辑 -> updateTouch. 位置/大小/名称/类型/Prompt 一起落盘
const confirmEdit = async () => {
	// 新建
	if (mode === "new" && draft.value) {
		const NAME = editName.value.trim() || I18N.value.untitled
		await L2D.addTouch({
			name: NAME,
			type: editType.value,
			x: draft.value.x,
			y: draft.value.y,
			w: draft.value.w,
			h: draft.value.h,
			prompt: editPrompt.value
		})
		await logger.info(`添加触摸区域: ${NAME}`)
		draft.value = null
		editing.value = null
		editName.value = ""
		editType.value = "tap"
		editPrompt.value = ""
		mode = "idle"
		return
	}
	// 编辑已有区域
	if (mode === "editing" && editing.value) {
		const NAME = editName.value.trim() || I18N.value.untitled
		await L2D.updateTouch(editing.value.id, {
			name: NAME,
			type: editType.value,
			x: editing.value.x,
			y: editing.value.y,
			w: editing.value.w,
			h: editing.value.h,
			prompt: editPrompt.value
		})
		await logger.info(`更新触摸区域: ${NAME}`)
		editing.value = null
		editName.value = ""
		editType.value = "tap"
		editPrompt.value = ""
		mode = "idle"
	}
}

// 取消, 编辑: Store 从未被修改, 直接丢弃 editing, 新建: 区域与表单全部清空.
const cancelEdit = () => {
	draft.value = null
	editing.value = null
	editName.value = ""
	editType.value = "tap"
	editPrompt.value = ""
	mode = "idle"
	pointerId = -1
	resizeHandle = null
	hovering.value = null
}

// 删除
const pendingRemove = ref<TouchArea | null>(null)

// 删除确认弹窗
const showRemoveConfirm = ref(false)

// 删除确认
const remove = (t: TouchArea) => {
	// 编辑 / 新建期间禁止删除其他区域
	if (mode !== "idle") return
	pendingRemove.value = t
	showRemoveConfirm.value = true
}

// 删除执行
const doRemove = async () => {
	const T = pendingRemove.value
	pendingRemove.value = null
	showRemoveConfirm.value = false
	if (!T) return
	await L2D.removeTouch(T.id)
	await logger.info(`删除触摸区域: ${T.name}`)
}

// 渲染 Live2D
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

onMounted(() => {
	raf = requestAnimationFrame(render)
	// 监听画布容器尺寸变化: 窗口宽高变换会让选区(百分比+绝对定位)与模型错位,
	// 这里在尺寸变化时自增 sizeTick, 触发选区的 style/handle 重新按新尺寸计算
	const EL = canvas.value
	if (EL && typeof ResizeObserver !== "undefined") {
		resizeObserver = new ResizeObserver(() => {
			sizeTick.value++
		})
		resizeObserver.observe(EL)
	}
})

onBeforeUnmount(() => {
	cancelAnimationFrame(raf)
	if (resizeObserver) {
		resizeObserver.disconnect()
		resizeObserver = null
	}
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
					:class="[
						{
							locked: mode === 'drawing',
							editing: mode === 'editing' || mode === 'new'
						},
						hovering ? `handle-${hovering}` : ''
					]"
					@pointerdown="down"
					@pointermove="move"
					@pointerup="up"
					@pointercancel="up"
					@pointerleave="hovering = null"
				>
					<canvas ref="canvas" class="touch-model-preview"/>
					<div
						v-for="t in L2D.touches"
						:key="t.id"
						class="touch-box saved"
						:class="[
							editing?.id === t.id ? editing?.type : t.type,
							{
								active: mode === 'editing' && editing?.id === t.id,
								editing: mode === 'editing' && editing?.id === t.id,
								dimmed:
									(mode === 'editing' && editing?.id !== t.id) ||
									mode === 'new'
							}
						]"
						:style="style(editing?.id === t.id ? editing : t)"
					>
						<span class="touch-box-name">{{ editing?.id === t.id ? editName || t.name : t.name }}</span>
					</div>
					<div v-if="draft" class="touch-box active draft" :style="style(draft)">
						<span class="touch-box-name">{{ editName || I18N.draftLabel }}</span>
					</div>
					<template v-if="targetRect">
						<div
							v-for="h in HANDLES"
							:key="h"
							class="touch-handle"
							:class="h"
							:style="handleStyle(targetRect, h)"
						/>
					</template>
					<span v-if="!L2D.isInitialized" class="touch-hint">{{ I18N.loadingModel }}</span>
				</div>
			</div>
			<aside class="touch-right">
				<ul v-if="L2D.touches.length" class="touch-list">
					<li
						v-for="t in L2D.touches"
						:key="t.id"
						class="touch-item"
						:class="{ disabled: mode !== 'idle' && editing?.id !== t.id }"
					>
						<span class="touch-item-type" :class="t.type">
							{{
								t.type === "tap" ? I18N.typeTap : t.type === "swipe" ? I18N.typeSwipe : I18N.typeFrenzy
							}}
						</span>
						<span class="touch-item-name">{{ t.name }}</span>
						<span class="touch-item-size">
							({{ (t.w * 100).toFixed(0) }}% × {{ (t.h * 100).toFixed(0) }}%)
						</span>
						<div class="touch-item-actions">
							<button class="mini-btn" :disabled="mode !== 'idle'" @click="startEdit(t)">
								<Icon name="settings" :size="13"/>
							</button>
							<button class="mini-btn danger" :disabled="mode !== 'idle'" @click="remove(t)">
								<Icon name="close" :size="13"/>
							</button>
						</div>
					</li>
				</ul>
				<p v-else class="touch-empty">{{ I18N.empty }}</p>
				<div
					v-if="mode === 'new' || mode === 'editing' || mode === 'moving' || mode === 'resizing'"
					class="touch-editor"
				>
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
						<button v-if="mode === 'new'" class="exc-btn redraw" @click="redraw">
							<Icon name="refresh" :size="14"/>
							<span>{{ I18N.redraw }}</span>
						</button>
						<button class="exc-btn done" @click="confirmEdit">
							<Icon name="check" :size="14"/>
							<span>{{ mode === "new" ? I18N.add : I18N.save }}</span>
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

	&.editing {
		cursor: default;
	}

	&.handle-nw, &.handle-se {
		cursor: nwse-resize;
	}

	&.handle-ne, &.handle-sw {
		cursor: nesw-resize;
	}

	&.handle-n, &.handle-s {
		cursor: ns-resize;
	}

	&.handle-e, &.handle-w {
		cursor: ew-resize;
	}

	&.locked {
		cursor: crosshair;
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

	&.active {
		z-index: 5;
	}

	&.draft {
		border-style: dashed;
		border-color: var(--touch-draft);
		background-color: color-mix(in srgb, var(--touch-draft) 22%, transparent);
	}

	&.editing {
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}

	&.dimmed {
		opacity: 0.45;
	}
}

.touch-box-name {
	pointer-events: none;
	user-select: none;
}

.touch-handle {
	position: absolute;
	width: 1.3rem;
	height: 1.3rem;
	box-sizing: border-box;
	transform: translate(-50%, -50%);
	border: 0.18rem solid var(--deep-teal-bright);
	background-color: #071318;
	border-radius: 0.3rem;
	pointer-events: none;
	box-shadow: 0 0 0.4rem var(--glow-teal-soft), 0 0 0.2rem rgba(0, 0, 0, 0.9);
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

	&.disabled {
		opacity: 0.5;
	}

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

	&:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

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
