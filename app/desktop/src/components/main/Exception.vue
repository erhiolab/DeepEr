<script setup lang="ts">
import {computed, ref} from "vue"
import {toast} from "vue3-toastify"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {useLive2DStore} from "../../services/store/live2d.ts"
import Icon from "../common/Icon.vue"
import type {IconName} from "../../services/icon"

const I18N = computed(() => useLanguages().components.main.exception)

const L2D = useLive2DStore()

// 刷新中标记 (防重复点击)
const refreshing = ref(false)

// 刷新 Live2D 模型 (重新加载当前模型)
const handleRefreshLive2d = async () => {
	if (refreshing.value) return
	refreshing.value = true
	try {
		const OK = await L2D.reloadModel()
		if (!OK) {
			toast.error(I18N.value.noModel)
		}
	} catch (error) {
		console.error("刷新 Live2D 模型失败:", error)
		toast.error(I18N.value.refreshFailed)
	} finally {
		refreshing.value = false
	}
}

// 异常处理操作列表
interface ExceptionAction {
	icon: IconName
	name: string
	desc: string
	action: () => Promise<void> | void
	disabled?: () => boolean
	loading?: () => boolean
	actionIcon: IconName
	actionLabel: () => string
}

// 切换可触摸区域显示
const handleToggleHitAreas = () => {
	L2D.setShowHitAreas(!L2D.showHitAreas)
}

const ACTIONS: ExceptionAction[] = [
	{
		icon: "refresh",
		name: I18N.value.refreshLive2d,
		desc: I18N.value.refreshLive2dDesc,
		action: handleRefreshLive2d,
		disabled: () => refreshing.value || L2D.isLoading,
		loading: () => refreshing.value,
		actionIcon: "refresh",
		actionLabel: () => I18N.value.refresh,
	},
	{
		icon: "eye",
		name: I18N.value.showHitAreas,
		desc: I18N.value.showHitAreasDesc,
		action: handleToggleHitAreas,
		disabled: () => !L2D.l2dInstance || L2D.isLoading,
		loading: () => false,
		actionIcon: "eye",
		actionLabel: () => (L2D.showHitAreas ? I18N.value.hide : I18N.value.show),
	},
]
</script>

<template>
	<section key="exception" class="page-exception">
		<header class="exc-head">
			<h2 class="exc-title">{{ I18N.title }}</h2>
			<p class="exc-sub">{{ I18N.subtitle }}</p>
		</header>
		<ul class="exc-list">
			<li v-for="item in ACTIONS" :key="item.name" class="exc-item">
				<span class="exc-icon"><Icon :name="item.icon" :size="20"/></span>
				<div class="exc-body">
					<span class="exc-name">{{ item.name }}</span>
					<span class="exc-desc">{{ item.desc }}</span>
				</div>
				<button
					class="exc-btn"
					:disabled="item.disabled ? item.disabled() : false"
					@click="item.action()"
				>
					<Icon name="loading" class="animate-spin" :size="14" v-if="item.loading && item.loading()"/>
					<Icon :name="item.actionIcon" :size="14" v-else/>
					<span>{{ item.actionLabel() }}</span>
				</button>
			</li>
		</ul>
	</section>
</template>

<style scoped lang="less">
.page-exception {
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 1.6rem;

	.exc-head {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.exc-title {
		font-size: 1.8rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: 0 0 1.8rem var(--glow-teal), 0 0 6rem var(--glow-teal-soft);
	}

	.exc-sub {
		font-size: 1.2rem;
		color: var(--text-muted);
	}
}

.exc-list {
	width: 100%;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
}

.exc-item {
	padding: 1.1rem 1.4rem;
	display: flex;
	align-items: center;
	gap: 1.2rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--deep-teal-soft);
		background-color: rgba(125, 227, 255, 0.06);
	}
}

.exc-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 4rem;
	height: 4rem;
	flex-shrink: 0;
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.12);
	color: var(--deep-teal-bright);
}

.exc-body {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.2rem;

	.exc-name {
		font-size: 1.4rem;
		color: var(--text-primary);
	}

	.exc-desc {
		font-size: 1.1rem;
		color: var(--text-muted);
	}
}

.exc-btn {
	padding: 0.7rem 1.4rem;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	flex-shrink: 0;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.08);
	color: var(--deep-teal-bright);
	font-size: 1.2rem;
	font-family: inherit;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: rgba(125, 227, 255, 0.18);
		border-color: var(--deep-teal);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
}
</style>
