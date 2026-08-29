<script setup lang="ts">
import {computed, onMounted, ref} from "vue"
import {useRouter} from "vue-router"
import useLanguages from "../services/i18n/useLanguages"
import {config} from "../services/config"
import {useUnsavedGuard} from "../services/store/unsaved"
import {minimizeWindow, toggleMaximizeWindow} from "../services/window"
import {setChatPageActive} from "../services/chatNotify"

import Icon from "../components/common/Icon.vue"
import {IconName} from "../services/icon"
import TitleBar from "../components/common/TitleBar.vue"
import Live2D from "../components/Live2D.vue"

import Home from "../components/main/Home.vue"
import Talk from "../components/main/Talk.vue"
import CharacterDesign from "../components/main/CharacterDesign.vue"

import ModelSelect from "../components/main/ModelSelect.vue"
import ModelConfig from "../components/main/ModelConfig.vue"
import Touch from "../components/main/Touch.vue"

import LLMAdapter from "../components/main/LLMAdapter.vue"
import TTSAdapter from "../components/main/TTSAdapter.vue"
import Scheduled from "../components/main/Scheduled.vue"
import Memory from "../components/main/Memory.vue"
import ToolList from "../components/main/ToolList.vue"

import LanguageSelect from "../components/main/LanguageSelect.vue"
import Exception from "../components/main/Exception.vue"
import About from "../components/firstRun/About.vue"

const I18N = computed(() => useLanguages().views.main)

const UNSURE_GUARD = useUnsavedGuard()

const ROUTER = useRouter()

// 侧边导航项键
type NavKey =
	"home" | "talk" | "memory" | "characterDesign" |
	"model" | "touch" |
	"llm" | "tts" | "scheduled" | "tool" |
	"language" | "exception" | "about"

// 侧边导航项
interface NavItem {
	key: NavKey
	icon: IconName
}

// 侧边导航项分组
interface NavGroup {
	type: "petGroup" | "live2dGroup" | "agentGroup" | "settingGroup"
	items: NavItem[]
}

// 侧边导航项分组
const NAV_GROUPS: NavGroup[] = [
	{
		type: "petGroup",
		items: [
			{key: "home", icon: "page"},
			{key: "talk", icon: "send"},
			{key: "characterDesign", icon: "book-user"},
		],
	},
	{
		type: "live2dGroup",
		items: [
			{key: "model", icon: "cube"},
			{key: "touch", icon: "settings"},
		],
	},
	{
		type: "agentGroup",
		items: [
			{key: "llm", icon: "robot"},
			{key: "tts", icon: "volume"},
			{key: "scheduled", icon: "alarm-clock"},
			{key: "memory", icon: "database"},
			{key: "tool", icon: "tool-case"},
		],
	},
	{
		type: "settingGroup",
		items: [
			{key: "language", icon: "globe"},
			{key: "exception", icon: "error"},
			{key: "about", icon: "info"},
		],
	},
]

// 所有侧边导航项
const ALL_NAV_ITEMS = computed(() => NAV_GROUPS.flatMap((group) => group.items))

// 当前激活的导航项
const activeNav = ref<NavKey>("home")

// 正在配置的模型 id (非 null 时, model 导航下改为展示 ModelConfig)
const configModelId = ref<string | null>(null)

// 从 ModelSelect 打开某模型的配置页
const openModelConfig = (modelId: string) => {
	configModelId.value = modelId
	if (activeNav.value !== "model") {
		activeNav.value = "model"
		config.set("main_active_nav", "model")
	}
}

// 关闭模型配置页, 回到模型选择
const closeModelConfig = () => {
	configModelId.value = null
}

// 判断是否为合法导航键
const isNavKey = (value: string): value is NavKey => NAV_GROUPS.some((group) => group.items.some((item) => item.key === value))

onMounted(async () => {
	const SAVED = await config.get("main_active_nav")
	if (SAVED && isNavKey(SAVED)) activeNav.value = SAVED
	setChatPageActive(activeNav.value === "talk")
})

// 切换方向: 1 = 下, -1 = 上 (决定动画方向)
const direction = ref(1)

// 切换导航项
const switchNav = async (key: NavKey) => {
	if (key === activeNav.value) return
	// 当前页面可能持有未保存修改, 离开前先询问
	if (!(await UNSURE_GUARD.requestLeave())) return
	const ACTIVE_INDEX = ALL_NAV_ITEMS.value.findIndex((item) => item.key === activeNav.value)
	const TARGET_INDEX = ALL_NAV_ITEMS.value.findIndex((item) => item.key === key)
	direction.value = TARGET_INDEX > ACTIVE_INDEX ? 1 : -1
	activeNav.value = key
	setChatPageActive(key === "talk")
	// 离开模型导航时关闭配置页回到模型列表
	if (key !== "model") configModelId.value = null
	await config.set("main_active_nav", key)
}

// 回到桌宠
const goToPet = () => {
	ROUTER.push({name: "Pet"})
}

// 最小化主界面窗口
const minimize = () => {
	void minimizeWindow()
}

// 切换主界面窗口最大化状态
const toggleMaximize = () => {
	void toggleMaximizeWindow()
}
</script>

<template>
	<div class="main-window">
		<TitleBar>
			<span class="nav-title" data-tauri-drag-region>{{ I18N[activeNav] }}</span>
			<div class="titlebar-right">
				<button class="control-btn minimize-btn" :title="I18N.minimize" @click="minimize">
					<Icon name="minimize" class="control-icon"/>
				</button>
				<button class="control-btn maximize-btn" :title="I18N.maximize" @click="toggleMaximize">
					<Icon name="maximize" class="control-icon"/>
				</button>
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
					<Talk v-else-if="activeNav === 'talk'"/>
					<CharacterDesign v-else-if="activeNav === 'characterDesign'"/>

					<ModelSelect v-else-if="activeNav === 'model' && !configModelId" @configure="openModelConfig"/>
					<ModelConfig
						v-else-if="activeNav === 'model' && configModelId"
						:model-id="configModelId"
						@close="closeModelConfig"
					/>
					<Touch v-else-if="activeNav === 'touch'"/>

					<LLMAdapter v-else-if="activeNav === 'llm'"/>
					<TTSAdapter v-else-if="activeNav === 'tts'"/>
					<Scheduled v-else-if="activeNav === 'scheduled'"/>
					<Memory v-else-if="activeNav === 'memory'"/>
					<ToolList v-else-if="activeNav === 'tool'"/>

					<LanguageSelect v-else-if="activeNav === 'language'"/>
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
		gap: 0.4rem;

		.control-btn {
			width: 2.6rem;
			height: 2.6rem;
			border: none;
			border-radius: var(--radius-sm);
			background: transparent;
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: all 0.2s ease;

			.control-icon {
				width: 1.5rem;
				height: 1.5rem;
			}

			&:hover {
				background: rgba(125, 227, 255, 0.12);
				color: var(--deep-teal-bright);
			}
		}

		.close-btn {
			width: 2.6rem;
			height: 2.6rem;
			border: none;
			border-radius: var(--radius-sm);
			background: transparent;
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: all 0.2s ease;

			.close-icon {
				width: 1.5rem;
				height: 1.5rem;
			}

			&:hover {
				background: rgba(255, 87, 87, 0.18);
				color: #ff6b6b;
			}
		}
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
	overflow: hidden auto;

	.nav-group-divider {
		display: flex;
		align-items: center;
		margin: 1rem 0 0.2rem;
		padding: 0 0.4rem;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: 0.08rem;
		color: var(--text-muted);
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
