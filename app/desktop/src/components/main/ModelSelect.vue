<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {logger} from "../../services/logger"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {createResourceDownload, formatBytes} from "../../services/resourceDownload"
import {useLive2DStore} from "../../services/store/live2d.ts"
import Icon from "../Icon.vue"
import ProgressBar from "../ProgressBar.vue"
import nori from "../../assets/images/live2D/Nori.webp"
import arNori from "../../assets/images/live2D/ARGNori.webp"

const I18N = computed(() => useLanguages().components.main.modelSelect)

const L2D = useLive2DStore()

// 配置键名
const CONFIG_KEY_MODEL = "selected_model"

interface Model {
	id: string
	name: string
	thumb: string
}

// 官方模型
const officialModels: Model[] = [
	{id: "arg-nori", name: "ARG Nori", thumb: arNori},
	{id: "nori", name: "Nori", thumb: nori}
]

// 自定义模型
interface CustomModel {
	id: string
	name: string
}

const customModels = ref<CustomModel[]>([])

// 已安装的模型 id 集合
const installedIds = ref<Set<string>>(new Set())

// 各模型大小 (bytes)
const modelSizes = ref<Record<string, number>>({})

// 选中的模型 id (点击卡片选中)
const selected = ref<string | null>(null)

// 当前应用的模型 id (打钩标记)
const applied = ref<string | null>(null)

// 通用下载控制器
const DOWNLOAD = createResourceDownload()

// 拉取已安装资源信息 (name + size)
const loadInstalled = async (): Promise<void> => {
	try {
		const list = await invoke<
			{ name: string; size: number }[]
		>("list_resources", {resourceType: "live2d"})
		const NAMES = list.map(item => item.name)
		const SIZES: Record<string, number> = {}
		for (const ITEM of list) SIZES[ITEM.name] = ITEM.size
		installedIds.value = new Set(NAMES)
		modelSizes.value = SIZES
		// 导入模型 = 已安装模型中去掉官方模型
		const OFFICIAL_IDS = officialModels.map(m => m.id)
		customModels.value = list
			.filter(item => !OFFICIAL_IDS.includes(item.name))
			.map(item => ({id: item.name, name: item.name}))
	} catch (error) {
		await logger.error("读取已安装资源失败:", error)
	}
}

// 读取当前应用的模型
const loadApplied = async (): Promise<void> => {
	try {
		applied.value = await invoke<string | null>("get_config", {key: CONFIG_KEY_MODEL})
	} catch (error) {
		await logger.error("读取模型配置失败:", error)
	}
}

onMounted(async () => {
	await Promise.all([loadInstalled(), loadApplied()])
})

// 判断模型是否已安装
const isInstalled = (id: string): boolean => installedIds.value.has(id)

// 获取模型大小 (bytes)
const sizeOf = (id: string): number | undefined => modelSizes.value[id]

// 选中模型的安装状态 (决定操作栏按钮)
const selectedInstalled = computed(() => (selected.value ? isInstalled(selected.value) : false))

// 应用模型
const handleApply = async (): Promise<void> => {
	if (!selected.value) return
	const ID = selected.value
	try {
		const SUCCESS = await L2D.switchModel(ID)
		if (!SUCCESS) {
			await logger.error(`应用模型失败: ${ID}`)
			return
		}
		// 加载成功后才持久化配置, 避免失败时配置已指向未成功应用的模型
		await invoke("set_config", {key: CONFIG_KEY_MODEL, value: ID})
		await logger.info(`保存模型配置: ${ID}`)
		applied.value = ID
	} catch (error) {
		await logger.error("应用模型失败:", error)
	}
}

// 删除模型
const handleDelete = async (): Promise<void> => {
	if (!selected.value) return
	const ID = selected.value
	try {
		await invoke("delete_resource", {resourceType: "live2d", name: ID})
		await logger.info(`删除模型: ${ID}`)
		// 若删除的是当前应用模型, 清理配置, 应用标记与 L2D 状态
		if (applied.value === ID) {
			try {
				await invoke("delete_config", {key: CONFIG_KEY_MODEL})
			} catch (error) {
				await logger.error("删除配置失败:", error)
			}
			applied.value = null
			await L2D.destroyModel()
		}
		selected.value = null
		await loadInstalled()
	} catch (error) {
		await logger.error("删除模型失败:", error)
	}
}

// 下载状态文案
const downloadStatusText = computed(() => {
	switch (DOWNLOAD.state.step) {
		case "downloading":
			return I18N.value.downloading
		case "download-done":
			return I18N.value.downloadDone
		case "extracting":
			return I18N.value.extracting
		case "done":
			return I18N.value.downloadReady
		case "error":
			return DOWNLOAD.state.message || I18N.value.downloadFailed
		default:
			return ""
	}
})

// 是否正在下载中 (显示进度条)
const showProgress = computed(() =>
	["downloading", "download-done", "extracting"].includes(DOWNLOAD.state.step)
)

// 进度明细文案
const progressText = computed(() => {
	if (DOWNLOAD.state.step !== "downloading") return ""
	return DOWNLOAD.state.total
		? `${formatBytes(DOWNLOAD.state.downloaded ?? 0)} / ${formatBytes(DOWNLOAD.state.total)}`
		: formatBytes(DOWNLOAD.state.downloaded ?? 0)
})

// 下载模型
const handleDownload = async (): Promise<void> => {
	if (!selected.value) return
	await DOWNLOAD.ensure("live2d", selected.value)
}

// 下载/解压进入完成态 (done/installed) 时刷新已安装列表
// note: ensure 的 invoke 返回早于前端事件队列推进到 done, 故此处用 watch 而非 ensure 后同步判断.
watch(
	() => DOWNLOAD.state.step,
	(step) => {
		if (step === "done" || step === "installed") {
			void loadInstalled()
		}
	}
)

onBeforeUnmount(() => {
	DOWNLOAD.stop()
})
</script>

<template>
	<section key="model-select" class="page page-model" @click="selected = null">
		<div class="group">
			<div class="group-title">{{ I18N.officialTitle }}</div>
			<div class="cards">
				<button
					v-for="model in officialModels"
					:key="model.id"
					class="model-card"
					:class="{selected: selected === model.id}"
					@click.stop="selected = model.id"
				>
					<span class="model-thumb-wrap">
						<img class="model-thumb" :src="model.thumb" :alt="model.name"/>
						<span class="check-badge" :class="{on: applied === model.id}">
							<icon name="check"/>
						</span>
					</span>
					<span class="model-name">{{ model.name }}</span>
					<span class="model-meta">
						<span class="status-badge" :class="isInstalled(model.id) ? 'installed' : 'missing'">
							{{ isInstalled(model.id) ? I18N.installed : I18N.notInstalled }}
						</span>
						<span v-if="sizeOf(model.id) != null" class="model-size">
							{{ formatBytes(sizeOf(model.id)!) }}
						</span>
					</span>
				</button>
			</div>
		</div>
		<div class="group">
			<div class="group-title">
				{{ I18N.customTitle }}
				<button class="import-btn" disabled>
					<icon name="import" :size="15"/>
					<span>{{ I18N.importModel }}</span>
				</button>
			</div>
			<div class="cards">
				<template v-if="customModels.length">
					<button
						v-for="model in customModels"
						:key="model.id"
						class="model-card"
						:class="{selected: selected === model.id}"
						@click.stop="selected = model.id"
					>
						<span class="model-thumb-wrap">
							<span class="model-thumb model-placeholder">
								<icon name="cube" :size="42"/>
							</span>
							<span class="check-badge" :class="{on: applied === model.id}">
								<icon name="check"/>
							</span>
						</span>
						<span class="model-name">{{ model.name }}</span>
						<span class="model-meta">
							<span v-if="sizeOf(model.id) != null" class="model-size">
								{{ formatBytes(sizeOf(model.id)!) }}
							</span>
						</span>
					</button>
				</template>
				<div v-else class="empty-state">{{ I18N.customEmpty }}</div>
			</div>
		</div>
		<footer class="action-bar" :class="{raised: !!selected || showProgress}" @click.stop>
			<template v-if="showProgress">
				<div class="bar-download">
					<ProgressBar :percent="DOWNLOAD.state.percent" :text="progressText || downloadStatusText"/>
					<span class="download-status">{{ downloadStatusText }}</span>
				</div>
			</template>
			<template v-else-if="selected">
				<button
					v-if="selectedInstalled"
					class="bar-btn apply"
					:disabled="applied === selected"
					@click.stop="handleApply"
				>
					{{ I18N.apply }}
				</button>
				<button v-if="selectedInstalled" class="bar-btn danger" @click.stop="handleDelete">
					{{ I18N.delete }}
				</button>
				<button v-if="!selectedInstalled" class="bar-btn" @click.stop="handleDownload">
					{{ I18N.download }}
				</button>
			</template>
		</footer>
	</section>
</template>

<style scoped lang="less">
.page {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.4rem;
	overflow: hidden;
	position: relative;
}

.group {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.group-title {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	color: var(--text-body);
	font-size: 1.3rem;
	font-weight: 600;
	letter-spacing: 0.03rem;
}

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
	gap: 1.4rem;
}

.model-card {
	padding: 0.8rem 0.8rem 1.0rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.7rem;
	border: 0.2rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.04);
	cursor: pointer;
	font-family: inherit;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.08);
		border-color: var(--nori-teal-soft);
		transform: translateY(-0.2rem);
	}

	&.selected {
		border-color: var(--nori-teal);
		background-color: rgba(125, 227, 255, 0.1);
		box-shadow: 0 0 1.6rem var(--glow-teal-soft);
	}
}

.model-thumb-wrap {
	width: 16rem;
	height: 16rem;
	display: grid;
	grid-template-areas: "thumb";
	place-items: center;
	overflow: hidden;
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);
}

.model-thumb {
	grid-area: thumb;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.model-placeholder {
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--text-faint);
}

.check-badge {
	margin: 0.5rem;
	width: 1.8rem;
	height: 1.8rem;
	grid-area: thumb;
	align-self: start;
	justify-self: end;
	border-radius: 50%;
	background-color: var(--bg-deep);
	border: 0.15rem solid var(--line-strong);
	color: var(--text-muted);
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0.35;
	transition: all 0.2s ease;

	:deep(svg) {
		width: 1.1rem;
		height: 1.1rem;
	}

	&.on {
		opacity: 1;
		background-color: var(--nori-teal);
		border-color: var(--nori-teal);
		color: #05121a;
		transform: scale(1);
	}
}

.model-name {
	font-size: 1.3rem;
	font-weight: 500;
	color: var(--text-primary);
}

.model-meta {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}

.status-badge {
	padding: 0.15rem 0.6rem;
	font-size: 1rem;
	border-radius: 99.9rem;
	border: 0.1rem solid currentColor;

	&.installed {
		color: var(--nori-teal-soft);
	}

	&.missing {
		color: var(--text-faint);
	}
}

.model-size {
	font-size: 1.1rem;
	color: var(--text-faint);
	font-variant-numeric: tabular-nums;
}

.import-btn {
	padding: 0.35rem 0.9rem;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--text-body);
	font-family: inherit;
	font-size: 1.15rem;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.1);
		color: var(--nori-teal-bright);
	}
}

.empty-state {
	flex: 1;
	min-height: 14rem;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 0.1rem dashed var(--line-subtle);
	border-radius: var(--radius-md);
	color: var(--text-faint);
	font-size: 1.25rem;
}

.action-bar {
	padding: 1.1rem 2rem;
	width: 100%;
	height: 5.8rem;
	flex-shrink: 0;
	margin-top: auto;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	border-top: 0.1rem solid var(--line-subtle);
	background-color: rgba(5, 14, 26, 0.6);
	backdrop-filter: blur(0.6rem);
	transform: translateY(100%);
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

	&.raised {
		transform: translateY(0);
	}
}

.bar-download {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.4rem;
}

.download-status {
	color: var(--text-faint);
	font-size: 1.15rem;
}

.bar-btn {
	padding: 0.8rem 2.4rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.06);
	color: var(--text-body);
	font-family: inherit;
	font-size: 1.3rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: rgba(125, 227, 255, 0.14);
		color: var(--nori-teal-bright);
	}

	&:disabled {
		cursor: default;
		opacity: 0.4;
	}

	&.apply {
		border: none;
		color: #05121a;
		background-image: linear-gradient(90deg, var(--nori-teal-bright), var(--nori-teal));

		&:hover:not(:disabled) {
			box-shadow: 0 0 1.4rem var(--glow-teal-soft);
		}
	}

	&.danger:hover:not(:disabled) {
		border-color: var(--danger);
		color: var(--danger);
		background-color: rgba(251, 44, 54, 0.1);
	}
}
</style>
