<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from "vue"
import {useRouter} from "vue-router"
import {emit} from "@tauri-apps/api/event"
import Live2D from "../components/Live2D.vue"
import Icon from "../components/common/Icon.vue"
import {
	persistWindowState,
	setPassthrough,
	setPetWindow,
	setResizableWindow,
	setUnresizableWindow,
	startDragWindow,
	startResizeWindow,
	watchWindowState,
	type ResizeDirection
} from "../services/window"
import useLanguages from "../services/i18n/useLanguages.ts"

const I18N = computed(() => useLanguages().views.pet)

const ROUTER = useRouter()

// 气泡自动消失等待时长(毫秒)
const BUBBLE_TTL = 6000

// 气泡最多保留数量
const BUBBLE_MAX = 4

// 每个气泡占用高度阈值 (逻辑像素)
const PER_BUBBLE_SPACE = 110

// 气泡数据
type Bubble = {
	id: number
	text: string
}

// 气泡列表
const bubbles = ref<Bubble[]>([])

// 当前允许的最大气泡数 (根据窗口大小动态变化)
const bubbleMax = ref<number>(4)

// 根据窗口高度计算当前最多允许显示的气泡数
const updateBubbleMax = () => {
	// 窗口高度越大可显示越多气泡, 但不超过 BUBBLE_MAX
	const H = window.innerHeight
	const BY_HEIGHT = Math.floor(H / PER_BUBBLE_SPACE)
	bubbleMax.value = Math.max(1, Math.min(BUBBLE_MAX, BY_HEIGHT))
}

// 窗口 resize 的 rAF 节流监听 (缩放剧烈时合并同一帧的多次触发, 减少重排抖动)
let bubbleResizeRaf = 0
const onWindowResize = () => {
	if (bubbleResizeRaf) return
	bubbleResizeRaf = requestAnimationFrame(() => {
		bubbleResizeRaf = 0
		updateBubbleMax()
	})
}

// 气泡ID计数器
let bubbleId = 0

// 各气泡的自动消失定时器
const bubbleTimers = new Map<number, ReturnType<typeof setTimeout>>()

// 添加一条气泡
const pushBubble = (text: string) => {
	// 逐条移除已超出上限的最早气泡(并清除其定时器)
	while (bubbles.value.length >= bubbleMax.value) {
		const OLDEST = bubbles.value[0]
		removeBubble(OLDEST.id)
	}
	const ID = ++bubbleId
	bubbles.value = [...bubbles.value, {id: ID, text}]
	// 开启自动消失定时
	bubbleTimers.set(ID, setTimeout(() => removeBubble(ID), BUBBLE_TTL))
}

// 移除气泡(触发离场动画后从数组剔除)
const removeBubble = (id: number) => {
	// 清除定时器
	const TIMER = bubbleTimers.get(id)
	if (TIMER) {
		clearTimeout(TIMER)
		bubbleTimers.delete(id)
	}
	bubbles.value = bubbles.value.filter((b) => b.id !== id)
}

// 手动移除 (点击气泡提前关闭)
const dismissBubble = (id: number) => {
	removeBubble(id)
}

// 组件卸载时清理全部定时器
const clearAllBubbleTimers = () => {
	for (const TIMER of bubbleTimers.values()) clearTimeout(TIMER)
	bubbleTimers.clear()
}

// 输入框文本
const inputText = ref("")

// 发送消息
const sendMessage = () => {
	const TEXT = inputText.value.trim()
	if (!TEXT) return
	pushBubble(TEXT)
	inputText.value = ""
}

// 是否悬浮在窗口上
const hovered = ref(false)

// 输入框是否聚焦 (聚焦期间即使鼠标移开也保持控制栏显示)
const inputFocused = ref(false)

// 控制栏是否显示: 鼠标悬浮 或 输入框聚焦
const controlsVisible = computed(() => hovered.value || inputFocused.value)

// 是否处于调整大小模式 (显示四角)
const resizing = ref(false)

// 四角及四边调整方向
const RESIZE_HANDLES: { position: string; direction: ResizeDirection }[] = [
	{position: "top-left", direction: "NorthWest"},
	{position: "top", direction: "North"},
	{position: "top-right", direction: "NorthEast"},
	{position: "right", direction: "East"},
	{position: "bottom-right", direction: "SouthEast"},
	{position: "bottom", direction: "South"},
	{position: "bottom-left", direction: "SouthWest"},
	{position: "left", direction: "West"}
]

// 打开主界面
const openMainView = () => {
	ROUTER.push({name: "Main"})
}

// 开启点击穿透
const enablePassthrough = () => {
	// 先收起悬浮 UI
	hovered.value = false
	// 结束输入框聚焦, 避免控制栏残留
	inputFocused.value = false
	// 若处于调整大小模式, 一并退出调整模式
	if (resizing.value) {
		resizing.value = false
		setUnresizableWindow()
	}
	setPassthrough()
	// 通知后端更新托盘菜单 (提供"取消穿透"入口)
	emit("pet-passthrough", true)
}

// 切换调整大小模式: 开启时允许窗口可调整(对角缩放)与移动, 关闭时恢复不可调整
const toggleResize = async () => {
	resizing.value = !resizing.value
	if (resizing.value) {
		// 允许窗口可调整 (原生对角缩放, 自由比例)
		await setResizableWindow()
	} else {
		await setUnresizableWindow()
		// 退出调整模式时保存一次当前窗口状态
		void persistWindowState(0)
	}
}

// 四角开始调整大小 (Tauri 原生对角缩放, 系统接管拖拽, 自由比例)
const onCornerMouseDown = (event: MouseEvent, direction: ResizeDirection) => {
	event.preventDefault()
	event.stopPropagation()
	// 若尚未开启调整模式, 先行开启 (原生缩放需要窗口可调整)
	if (!resizing.value) {
		resizing.value = true
		void setResizableWindow()
	}
	// 原生对角缩放
	void startResizeWindow(direction)
}

// 整体按住拖动窗口: 仅在调整模式下允许移动桌宠
const onStageMouseDown = (event: MouseEvent) => {
	if (event.button !== 0) return
	if (!resizing.value) return
	const target = event.target as HTMLElement
	if (target.closest("button, .pet-input, .resize-handle")) return
	void startDragWindow()
}

onMounted(async () => {
	await setPetWindow()
	// 根据当前窗口大小计算气泡上限, 并在窗口缩放时同步更新 (rAF 节流)
	updateBubbleMax()
	window.addEventListener("resize", onWindowResize)
	// 注册窗口移动/缩放监听, 结束操作后防抖保存窗口大小与位置
	stopWatchFn = await watchWindowState()
	// 进入桌宠即保存一次, 确保首次有数据落库
	await persistWindowState(0)
})

onUnmounted(() => {
	// 注销窗口监听
	if (stopWatchFn) stopWatchFn()
	// 移除窗口大小监听
	window.removeEventListener("resize", onWindowResize)
	// 清理气泡定时器
	clearAllBubbleTimers()
})

// 窗口监听注销函数 (在 onMounted 中赋值)
let stopWatchFn: (() => void) | null = null
</script>

<template>
	<div class="pet-stage" @mouseenter="hovered = true" @mouseleave="hovered = false" @mousedown="onStageMouseDown">
		<Live2D/>
		<!--气泡-->
		<div class="bubble-area">
			<TransitionGroup name="bubble">
				<div v-for="bubble in bubbles" :key="bubble.id" class="pet-bubble"
				     @click.stop="dismissBubble(bubble.id)">
					<span>{{ bubble.text }}</span>
				</div>
			</TransitionGroup>
		</div>
		<Transition name="controls" :duration="{enter: 420, leave: 420}">
			<div v-if="controlsVisible" class="pet-controls" :class="{resizing}">
				<!--左按钮组-->
				<div class="btn-col btn-col-left">
					<button class="pet-btn" :title="I18N.home" @mousedown.stop @click.stop="openMainView">
						<Icon name="page" :size="16"/>
					</button>
				</div>
				<!--右按钮组-->
				<div class="btn-col btn-col-right">
					<button class="pet-btn" :title="I18N.passthrough" @mousedown.stop @click.stop="enablePassthrough">
						<Icon name="dashed-mouse" :size="16"/>
					</button>
					<button
						class="pet-btn"
						:class="{active: resizing}"
						:title="resizing ? I18N.resizing : I18N.resize"
						@mousedown.stop
						@click.stop="toggleResize"
					>
						<Icon name="resize" :size="16"/>
					</button>
				</div>
				<!--输入框-->
				<form class="pet-input" @submit.prevent="sendMessage" @mousedown.stop>
					<input
						v-model="inputText"
						type="text"
						placeholder="..."
						@focus="inputFocused = true"
						@blur="inputFocused = false"
					/>
					<button class="pet-btn pet-btn-send" type="submit" :disabled="!inputText.trim()">
						<Icon name="send" :size="14"/>
					</button>
				</form>
			</div>
		</Transition>
		<!--调整大小-->
		<template v-if="resizing">
			<div
				v-for="handle in RESIZE_HANDLES"
				:key="handle.position"
				class="resize-handle"
				:class="`resize-${handle.position}`"
				@mousedown.prevent.stop="onCornerMouseDown($event, handle.direction)"
			/>
		</template>
	</div>
</template>

<style scoped lang="less">
.pet-stage {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	background: transparent;
	cursor: pointer;
	user-select: none;
}

.pet-controls {
	position: absolute;
	inset: 0;
	z-index: 20;
	pointer-events: none;
}

// 入场动画
// 输入框: 从下至上上升
// 左按钮组: 从右向左进入
// 右按钮组: 从左向右进入

// 进场/退场期间输入框的错开延时
.controls-enter-active .pet-input,
.controls-leave-active .pet-input {
	transition-delay: 0.18s;
}

// 进场初始: 全部隐藏并从各自起点位移
.controls-enter-from .pet-input {
	opacity: 0;
	transform: translateY(1.4rem);
}

.controls-enter-from .btn-col-left {
	opacity: 0;
	transform: translateX(-1.2rem);
}

.controls-enter-from .btn-col-right {
	opacity: 0;
	transform: translateX(1.2rem);
}

// 退场结束: 全部淡出并反向位移, 逐项错开
.controls-leave-to .pet-input {
	opacity: 0;
	transform: translateY(1.4rem);
}

.controls-leave-to .btn-col-left {
	opacity: 0;
	transform: translateX(-1.2rem);
}

.controls-leave-to .btn-col-right {
	opacity: 0;
	transform: translateX(1.2rem);
}

// 两侧按钮组 (与输入框同一水平带, 从下往上堆叠)
.btn-col {
	position: absolute;
	bottom: 1rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	pointer-events: auto;
	transition: opacity 0.34s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}

.btn-col-left {
	left: 0.9rem;
	transition-delay: 0s;
}

.btn-col-right {
	right: 0.9rem;
	transition-delay: 0.1s;
}

// 进入调整模式时, 按钮组与输入框上移, 让出四角与底边区域, 避免与缩放把手重叠
.pet-controls.resizing .btn-col {
	bottom: 4.4rem;
}

.pet-controls.resizing .pet-input {
	bottom: 4.2rem;
}

// 输入框随之上移时, 气泡区同步上移, 保持在其正上方
.pet-controls.resizing .bubble-area {
	bottom: 8rem;
}

.pet-btn {
	width: 2.9rem;
	height: 2.9rem;
	border: 0.1rem solid var(--teal-strong);
	border-radius: var(--radius-sm);
	background-color: var(--surface-deep);
	box-shadow: 0 0 0.6rem rgba(0, 0, 0, 0.35), 0 0 0.2rem var(--glow-teal-strong);
	color: var(--deep-teal-bright);
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	pointer-events: auto;
	transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;

	&:hover {
		background-color: var(--teal-strong);
		color: var(--ink-deep);
		transform: translateY(-0.15rem);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}

	&.active {
		background-color: var(--teal-fill);
		color: var(--ink-deep);
		border-color: var(--deep-teal-bright);
		box-shadow: inset 0 0 0 0.1rem var(--line-strong);
	}

	&:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		transform: none;
	}
}

// 气泡区 (输入框正上方, 居中, 宽度包裹气泡, 上限与输入框一致避开按钮组)
.bubble-area {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 4.6rem;
	margin-inline: auto;
	width: max-content;
	max-width: calc(100% - 9.6rem);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.5rem;
	pointer-events: none;
	z-index: 5;
}

// 气泡: 支持长文本自动换行
.pet-bubble {
	position: relative;
	max-width: 100%;
	padding: 0.7rem 1.1rem;
	background-color: var(--surface-glass);
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	color: var(--text-body);
	font-size: 1.1rem;
	line-height: 1.5;
	box-shadow: var(--shadow-soft);
	pointer-events: auto;
	cursor: pointer;
	word-break: break-word;
	overflow-wrap: break-word;
	white-space: pre-wrap;

	span {
		display: inline;
	}

	// 气泡底部小三角
	&::after {
		content: "";
		position: absolute;
		bottom: -0.45rem;
		left: 1.4rem;
		border: 0.45rem solid transparent;
		border-top-color: var(--bg-panel);
		border-bottom: none;
	}
}

// 气泡动画: 进入淡入上移, 离开淡出
.bubble-enter-active,
.bubble-leave-active {
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.bubble-enter-from {
	opacity: 0;
	transform: translateY(0.8rem) scale(0.96);
}

.bubble-leave-to {
	opacity: 0;
	transform: translateY(-0.8rem) scale(0.96);
}

// 输入框
.pet-input {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0.8rem;
	margin-inline: auto;
	padding: 0.3rem 0.3rem 0.3rem 1rem;
	width: calc(100% - 9.6rem);
	max-width: 26rem;
	display: flex;
	align-items: center;
	gap: 0.4rem;
	background-color: var(--surface-glass);
	border: 0.1rem solid var(--line-strong);
	border-radius: 99.9rem;
	pointer-events: auto;
	backdrop-filter: blur(4px);
	transition: opacity 0.34s ease, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.3s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s ease, box-shadow 0.2s ease;

	&:focus-within {
		border-color: var(--line-strong);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background-color: transparent;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 1.15rem;

		&::placeholder {
			color: var(--text-faint);
		}
	}
}

.pet-btn-send {
	width: 2.4rem;
	height: 2.4rem;
	border-radius: 50%;
	background-color: var(--teal-soft);
	color: var(--deep-teal-bright);

	&:hover {
		background-color: var(--teal-mid) !important;
		transform: none !important;
	}
}

// 调整控制点 (四角方块 + 四边细条)
.resize-handle {
	position: absolute;
	z-index: 30;
	background-color: var(--surface-deep);
	border-color: var(--deep-teal-bright);
	box-shadow: 0 0 0.8rem var(--glow-teal-mid), 0 0 0.3rem rgba(0, 0, 0, 0.4);
}

// 四角: 方块控制点 (对角缩放)
.resize-top-left,
.resize-top-right,
.resize-bottom-left,
.resize-bottom-right {
	border: 0.16rem solid var(--deep-teal-bright);
	border-radius: 0.2rem;
	width: 1.8rem;
	height: 1.8rem;
}

// 四边: 粗条控制点 (单向缩放)
.resize-top,
.resize-bottom {
	border-left: 0.14rem solid var(--deep-teal-bright);
	border-right: 0.14rem solid var(--deep-teal-bright);
	height: 1.4rem;
}

.resize-left,
.resize-right {
	border-top: 0.14rem solid var(--deep-teal-bright);
	border-bottom: 0.14rem solid var(--deep-teal-bright);
	width: 1.4rem;
}

.resize-top-left {
	top: -0.15rem;
	left: -0.15rem;
	cursor: nwse-resize;
}

.resize-top {
	top: -0.15rem;
	left: 50%;
	transform: translateX(-50%);
	cursor: ns-resize;
}

.resize-top-right {
	top: -0.15rem;
	right: -0.15rem;
	cursor: nesw-resize;
}

.resize-right {
	top: 50%;
	right: -0.15rem;
	transform: translateY(-50%);
	cursor: ew-resize;
}

.resize-bottom-right {
	bottom: -0.15rem;
	right: -0.15rem;
	cursor: nwse-resize;
}

.resize-bottom {
	bottom: -0.15rem;
	left: 50%;
	transform: translateX(-50%);
	cursor: ns-resize;
}

.resize-bottom-left {
	bottom: -0.15rem;
	left: -0.15rem;
	cursor: nesw-resize;
}

.resize-left {
	top: 50%;
	left: -0.15rem;
	transform: translateY(-50%);
	cursor: ew-resize;
}
</style>
