<script setup lang="ts">
import {computed, onMounted, ref} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {closeWindow} from "../services/window"
import useLanguages from "../services/i18n/useLanguages"
import {logger} from "../services/logger"
import Icon from "../components/Icon.vue"
import {IconName} from "../services/icon"
import TitleBar from "../components/TitleBar.vue"
import Live2D from "../components/Live2D.vue"
import Home from "../components/main/Home.vue"
import ModelSelect from "../components/main/ModelSelect.vue"

const I18N = computed(() => useLanguages().views.main)

// 侧边导航项
type NavKey = "home" | "talk" | "model" | "settings"

const CONFIG_KEY_ACTIVE_NAV = "main_active_nav"

// 侧边导航项
const NAV_ITEMS: { key: NavKey; icon: IconName }[] = [
	{key: "home", icon: "noriOS"},
	{key: "talk", icon: "send"},
	{key: "model", icon: "cube"},
	{key: "settings", icon: "settings"}
]

// 当前激活的导航项
const activeNav = ref<NavKey>("home")

// 判断是否为合法导航键
const isNavKey = (value: string): value is NavKey => NAV_ITEMS.some((item) => item.key === value)

onMounted(async () => {
	try {
		const SAVED = await invoke<string | null>("get_config", {key: CONFIG_KEY_ACTIVE_NAV})
		if (SAVED && isNavKey(SAVED)) {
			activeNav.value = SAVED
		}
	} catch (error) {
		await logger.error("读取导航页配置失败:", error)
	}
})

// 切换方向: 1 = 下, -1 = 上 (决定动画方向)
const direction = ref(1)

// 切换导航项
const switchNav = (key: NavKey) => {
	if (key === activeNav.value) return
	const ACTIVE_INDEX = NAV_ITEMS.findIndex((item) => item.key === activeNav.value)
	const TARGET_INDEX = NAV_ITEMS.findIndex((item) => item.key === key)
	direction.value = TARGET_INDEX > ACTIVE_INDEX ? 1 : -1
	activeNav.value = key
	invoke("set_config", {key: CONFIG_KEY_ACTIVE_NAV, value: key}).catch(async (error) => {
		await logger.error("保存导航页配置失败:", error)
	})
}
</script>

<template>
	<div class="main-window">
		<TitleBar>
			<span class="nav-title">{{ I18N[activeNav] }}</span>
			<div class="titlebar-right">
				<button class="close-btn" :title="I18N.close" @click="closeWindow">
					<Icon name="close" class="close-icon"/>
				</button>
			</div>
		</TitleBar>
		<div class="body">
			<aside class="sidebar">
				<button
					v-for="item in NAV_ITEMS"
					:key="item.key"
					class="nav-item"
					:class="{active: item.key === activeNav}"
					@click="switchNav(item.key)"
				>
					<Icon :name="item.icon" :size="18"/>
					<span>{{ I18N[item.key] }}</span>
				</button>
			</aside>
			<main class="content">
				<Transition :name="direction > 0 ? 'page-next' : 'page-prev'" mode="out-in">
					<Home v-if="activeNav === 'home'"/>
					<ModelSelect v-else-if="activeNav === 'model'"/>
				</Transition>
			</main>
			<div class="live2d-container">
				<Live2D/>
			</div>
		</div>
	</div>
</template>

<style scoped lang="less">
.main-window {
	width: 100%;
	height: 100%;
	background: linear-gradient(160deg, var(--bg-panel) 0%, var(--bg-abyss) 100%);
	border-radius: var(--radius-lg);
	display: flex;
	flex-direction: column;
	overflow: hidden;
	user-select: none;

	.nav-title {
		font-size: 1.3rem;
		color: var(--text-muted);
		letter-spacing: 0.04rem;
	}

	.titlebar-right {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
}

.body {
	flex: 1;
	min-height: 0;
	display: flex;
}

.sidebar {
	width: 14rem;
	padding: 1.2rem 0.8rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	border-right: 0.1rem solid var(--line-subtle);

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.9rem 1.1rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 1.3rem;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			background: rgba(125, 227, 255, 0.08);
			color: var(--text-primary);
		}

		&.active {
			background: rgba(125, 227, 255, 0.14);
			color: var(--nori-teal-bright);
			box-shadow: inset 0 0 0 0.1rem var(--line-strong);
		}
	}
}

.content {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	padding: 2rem;
	overflow: hidden;

	// 页面过渡: 下一项向下滑入, 上一项向上滑入
	.page-next-enter-active,
	.page-next-leave-active,
	.page-prev-enter-active,
	.page-prev-leave-active {
		transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.page-next-enter-from {
		opacity: 0;
		transform: translateY(3.6rem);
	}

	.page-next-leave-to {
		opacity: 0;
		transform: translateY(-3.6rem);
	}

	.page-prev-enter-from {
		opacity: 0;
		transform: translateY(-3.6rem);
	}

	.page-prev-leave-to {
		opacity: 0;
		transform: translateY(3.6rem);
	}
}

.live2d-container {
	width: 40rem;
	height: 100%;
	min-height: 0;
	border-left: 0.1rem solid var(--line-subtle);
}
</style>
