<script setup lang="ts">
import {computed, onMounted, ref} from "vue"
import {useRouter} from "vue-router"
import useLanguages from "../services/i18n/useLanguages"
import {config} from "../services/config"
import Icon from "../components/Icon.vue"
import {IconName} from "../services/icon"
import TitleBar from "../components/TitleBar.vue"
import Live2D from "../components/Live2D.vue"
import Home from "../components/main/Home.vue"
import ModelSelect from "../components/main/ModelSelect.vue"
import Touch from "../components/main/Touch.vue"
import About from "../components/firstRun/About.vue"
import LanguageSelect from "../components/main/LanguageSelect.vue"
import Exception from "../components/main/Exception.vue"

const I18N = computed(() => useLanguages().views.main)

const ROUTER = useRouter()

// 侧边导航项类型
type NavType = "petGroup" | "settingGroup"

// 侧边导航项
type NavKey = "home" | "talk" | "language" | "model" | "llm" | "tts" | "touch" | "exception" | "about"

// 侧边导航项
const NAV_ITEMS: { type: NavType; key: NavKey; icon: IconName }[] = [
	{type: "petGroup", key: "home", icon: "page"},
	{type: "petGroup", key: "talk", icon: "send"},
	{type: "settingGroup", key: "language", icon: "globe"},
	{type: "settingGroup", key: "model", icon: "cube"},
	{type: "settingGroup", key: "llm", icon: "robot"},
	{type: "settingGroup", key: "tts", icon: "microphone"},
	{type: "settingGroup", key: "touch", icon: "settings"},
	{type: "settingGroup", key: "exception", icon: "error"},
	{type: "settingGroup", key: "about", icon: "info"}
]

// 按类别分组的侧边导航项
const NAV_GROUPS: { type: NavType; items: typeof NAV_ITEMS }[] = (["petGroup", "settingGroup"] as NavType[])
	.map((type) => ({type, items: NAV_ITEMS.filter((item) => item.type === type)}))
	.filter((group) => group.items.length > 0)

// 当前激活的导航项
const activeNav = ref<NavKey>("home")

// 判断是否为合法导航键
const isNavKey = (value: string): value is NavKey => NAV_ITEMS.some((item) => item.key === value)

onMounted(async () => {
	const SAVED = await config.get("main_active_nav")
	if (SAVED && isNavKey(SAVED)) activeNav.value = SAVED
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
	config.set("main_active_nav", key)
}

// 回到桌宠
const goToPet = () => {
	ROUTER.push({name: "Pet"})
}
</script>

<template>
	<div class="main-window">
		<TitleBar>
			<span class="nav-title" data-tauri-drag-region>{{ I18N[activeNav] }}</span>
			<div class="titlebar-right">
				<button class="close-btn" :title="I18N.close" @click="goToPet">
					<Icon name="close" class="close-icon"/>
				</button>
			</div>
		</TitleBar>
		<div class="body">
			<aside class="sidebar">
				<template v-for="group in NAV_GROUPS" :key="group.type">
					<h3 class="nav-group-divider">{{ I18N[group.type] }}</h3>
					<button
						v-for="item in group.items"
						:key="item.key"
						class="nav-item"
						:class="{active: item.key === activeNav}"
						@click="switchNav(item.key)"
					>
						<Icon :name="item.icon" :size="18"/>
						<span>{{ I18N[item.key] }}</span>
					</button>
				</template>
			</aside>
			<main class="content">
				<Transition :name="direction > 0 ? 'page-next' : 'page-prev'" mode="out-in">
					<Home v-if="activeNav === 'home'"/>
					<LanguageSelect v-else-if="activeNav === 'language'"/>
					<ModelSelect v-else-if="activeNav === 'model'"/>
					<Touch v-else-if="activeNav === 'touch'"/>
					<Exception v-else-if="activeNav === 'exception'"/>
					<About v-else-if="activeNav === 'about'"/>
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

	.nav-group-divider {
		display: flex;
		align-items: center;
		margin: 1rem 0 0.2rem;
		padding: 0 0.4rem;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: 0.08rem;
		color: var(--text-muted);
		text-transform: uppercase;
		user-select: none;
	}

	// 首个分栏标题与侧边栏顶部拉开间距
	.nav-group-divider:first-child {
		margin-top: 0.4rem;
	}

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
			color: var(--deep-teal-bright);
			box-shadow: inset 0 0 0 0.1rem var(--line-strong);
		}
	}
}

.content {
	flex: 1;
	padding: 2rem;
	min-width: 0;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	justify-content: flex-start;
	gap: 1rem;
	overflow: hidden;
	border-right: 0.1rem solid var(--line-strong);
	border-left: 0.1rem solid var(--line-strong);

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
}
</style>
