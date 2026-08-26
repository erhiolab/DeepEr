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
import {useTouchStore} from "../services/store/touch.ts"

const I18N = computed(() => useLanguages().views.pet)

const ROUTER = useRouter()

const TOUCH = useTouchStore()

// 是否悬浮在窗口上
const hovered = ref(false)

// 控制栏是否显示: 鼠标悬浮
const controlsVisible = computed(() => hovered.value)

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
	// 若处于调整大小模式, 一并退出调整模式
	if (resizing.value) {
		resizing.value = false
		setUnresizableWindow()
		// 退出移动状态: 恢复触摸回调
		TOUCH.setMoving(false)
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
		// 进入移动状态: 期间不触发任何触摸回调
		TOUCH.setMoving(true)
	} else {
		await setUnresizableWindow()
		// 退出移动状态: 恢复触摸回调
		TOUCH.setMoving(false)
		// 退出调整模式时保存一次当前窗口状态
		void persistWindowState(0)
	}
}

// 按下 ESC 退出调整/移动模式
const onKeydown = (event: KeyboardEvent) => {
	if (event.key !== "Escape") return
	if (!resizing.value) return
	void toggleResize()
}

// 四角开始调整大小 (Tauri 原生对角缩放, 系统接管拖拽, 自由比例)
const onCornerMouseDown = async (event: MouseEvent, direction: ResizeDirection) => {
	event.preventDefault()
	event.stopPropagation()
	// 若尚未开启调整模式, 先行开启 (原生缩放需要窗口可调整)
	if (!resizing.value) {
		resizing.value = true
		await setResizableWindow()
		// 进入移动状态: 期间不触发任何触摸回调
		TOUCH.setMoving(true)
	}
	// 原生对角缩放
	void startResizeWindow(direction)
}

// 整体按住拖动窗口: 仅在调整模式下允许移动桌宠
const onStageMouseDown = (event: MouseEvent) => {
	if (event.button !== 0) return
	if (!resizing.value) return
	const target = event.target as HTMLElement
	if (target.closest("button, .resize-handle")) return
	void startDragWindow()
}

onMounted(async () => {
	// 应用保存的桌宠大小/位置; 返回是否存在已保存的位置记录
	const hasSavedPosition = await setPetWindow()
	// 注册窗口移动/缩放监听, 结束操作后防抖保存窗口大小与位置
	stopWatchFn = await watchWindowState()
	// 按 ESC 退出调整/移动模式
	window.addEventListener("keydown", onKeydown)
	// 仅当库中原本没有桌宠位置/大小记录 (首次运行或复位后) 时, 才把当前默认/居中
	// 状态写库建立基线. 若已有保存记录, 不在此处立即落盘, 避免读到窗口定位完成前
	// 的中间坐标而覆盖正确的保存位置 (这正是"重进桌宠跑到屏幕中间"的根因).
	if (!hasSavedPosition) {
		await persistWindowState(0)
	}
})

onUnmounted(() => {
	// 注销窗口监听
	if (stopWatchFn) stopWatchFn()
	// 恢复触摸回调 (若卸载时仍处于移动状态)
	TOUCH.setMoving(false)
	// 移除 ESC 按键监听
	window.removeEventListener("keydown", onKeydown)
})

// 窗口监听注销函数 (在 onMounted 中赋值)
let stopWatchFn: (() => void) | null = null
</script>

<template>
	<div class="pet-stage" @mouseenter="hovered = true" @mouseleave="hovered = false" @mousedown="onStageMouseDown">
		<Live2D/>
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
// 左按钮组: 从右向左进入
// 右按钮组: 从左向右进入

// 进场初始: 全部隐藏并从各自起点位移
.controls-enter-from .btn-col-left {
	opacity: 0;
	transform: translateX(-1.2rem);
}

.controls-enter-from .btn-col-right {
	opacity: 0;
	transform: translateX(1.2rem);
}

// 退场结束: 全部淡出并反向位移, 逐项错开
.controls-leave-to .btn-col-left {
	opacity: 0;
	transform: translateX(-1.2rem);
}

.controls-leave-to .btn-col-right {
	opacity: 0;
	transform: translateX(1.2rem);
}

// 两侧按钮组 (从下往上堆叠)
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

// 进入调整模式时, 按钮组上移, 让出四角与底边区域, 避免与缩放把手重叠
.pet-controls.resizing .btn-col {
	bottom: 4.4rem;
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
