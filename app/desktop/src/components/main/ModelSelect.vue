<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {open, save} from "@tauri-apps/plugin-dialog"
import {toast} from "vue3-toastify"
import {logger} from "../../services/logger"
import {config} from "../../services/config"
import {assetUrl} from "../../services/asset.ts"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {createResourceDownload, formatBytes} from "../../services/resourceDownload"
import {createResourceImport} from "../../services/resourceImport"
import {useLive2DStore} from "../../services/store/live2d.ts"
import Icon from "../common/Icon.vue"
import ProgressBar from "../common/ProgressBar.vue"
import ModelGate from "./ModelGate.vue"
import ConfirmDialog from "../common/ConfirmDialog.vue"

const I18N = computed(() => useLanguages().components.main.modelSelect)

const L2D = useLive2DStore()

// 官方模型 (来自后端 /live2d/list)
const officialModels = ref<Live2dModel[]>([])

// 官方模型列表是否正在从后端拉取中
const officialLoading = ref(false)

// 已安装的官方模型 (is_official = true, 来自本地索引)
const officialInstalled = ref<Live2dModel[]>([])

// 官方区展示: 线上官方模型, 已安装官方模型 (按 id 去重)
const displayOfficialModels = computed<Live2dModel[]>(() => {
	const MAP = new Map<string, Live2dModel>()
	for (const m of officialModels.value) MAP.set(m.id, m)
	for (const m of officialInstalled.value) {
		if (!MAP.has(m.id)) MAP.set(m.id, m)
	}
	return Array.from(MAP.values())
})

// 自定义模型 (已安装但不在官方列表)
interface CustomModel {
	id: string
	image?: string
	/** 显示名称 (来自模型配置顶层 name, 后端已回落为模型目录名/id) */
	name: string
}

// 全部已安装的非官方来源模型 (含被误导入的官方模型, 渲染时再按官方 id 剔除)
const customAll = ref<CustomModel[]>([])

// 官方模型 id 集合 (线上官方 + 已装官方)
const officialIds = computed<Set<string>>(() => new Set(displayOfficialModels.value.map(m => m.id)))

// 自定义区展示: 非官方已装模型中, 剔除已被官方区覆盖的 (避免官方模型重复出现在自定义区)
const customModels = computed<CustomModel[]>(() =>
	customAll.value.filter(m => !officialIds.value.has(m.id))
)

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

// 通用导入控制器
const IMPORT = createResourceImport()

// 官方模型
interface Live2dModel {
	id: string
	name: string
	coverUrl?: string
}

// 封面加载失败的模型 id
const brokenCovers = ref<string[]>([])

// 封面加载失败的模型 id
const isCoverBroken = (id: string): boolean => brokenCovers.value.includes(id)

// 标记封面加载失败
const markCoverBroken = (id: string): void => {
	if (!brokenCovers.value.includes(id)) brokenCovers.value.push(id)
}

// 自定义模型图标加载失败的模型 id (回落占位图标)
const brokenCustomIcons = ref<string[]>([])

// 自定义模型图标是否加载失败
const isIconBroken = (id: string): boolean => brokenCustomIcons.value.includes(id)

// 标记自定义模型图标加载失败
const markIconBroken = (id: string): void => {
	if (!brokenCustomIcons.value.includes(id)) brokenCustomIcons.value.push(id)
}

// 组装自定义模型图标的 asset 协议 URL
// 校验: 图片必须是模型目录内相对路径, 禁止 `..` 或绝对路径穿越
const iconUrl = (modelName: string, image: string): string | null => {
	const CLEAN = image.replace(/^\/+/, "").replace(/\\/g, "/")
	if (!CLEAN || CLEAN.startsWith("/")) return null
	const SEGMENTS = CLEAN.split("/")
	// 禁止 `..` 与空段 (路径穿越 / 多余分隔)
	if (SEGMENTS.some(seg => seg === ".." || seg === "." || !seg)) return null
	return `${assetUrl(`live2d/${modelName}`)}/${CLEAN}`
}

// 拉取官方模型列表
const loadOfficial = async (): Promise<void> => {
	const CACHED = sessionStorage.getItem("officialModels")
	let CACHED_JSON: unknown
	// 缓存解析失败按无缓存处理, 避免抛错导致整个列表不渲染
	try {
		CACHED_JSON = CACHED ? JSON.parse(CACHED) : null
	} catch {
		CACHED_JSON = null
	}
	if (Array.isArray(CACHED_JSON) && CACHED_JSON?.length > 0) {
		officialModels.value = CACHED_JSON as Live2dModel[]
		return
	}
	officialLoading.value = true
	try {
		const LIST = await invoke<Live2dModel[]>("fetch_live2d_list")
		if (Array.isArray(LIST)) officialModels.value = LIST
		sessionStorage.setItem("officialModels", JSON.stringify(LIST))
	} catch (error) {
		await logger.error("拉取 Live2D 模型列表失败", error)
		toast.error(I18N.value.loadModelsFailed)
	} finally {
		officialLoading.value = false
	}
}

// 已安装模型 (来自本地索引)
interface InstalledLive2dModel {
	name: string
	size: number
	entryFile?: string | null
	isOfficial?: boolean
	image?: string | null
	modelName?: string | null
}

// 拉取已安装资源信息
const loadInstalled = async (): Promise<void> => {
	try {
		const LIST = await invoke<InstalledLive2dModel[]>("list_resources", {resourceType: "live2d"})
		const NAMES = LIST.map(item => item.name)
		const SIZES: Record<string, number> = {}
		for (const ITEM of LIST) SIZES[ITEM.name] = ITEM.size
		installedIds.value = new Set(NAMES)
		modelSizes.value = SIZES
		customAll.value = LIST
			.filter(item => !item.isOfficial)
			.map(item => ({
				id: item.name,
				name: item.modelName || item.name,
				image: item.image || undefined,
			}))
		// 已安装官方模型 = is_official = true
		officialInstalled.value = LIST
			.filter(item => item.isOfficial)
			.map(item => ({id: item.name, name: item.name}))
		// 同步刷新 store 的入口文件映射 (用于加载)
		await L2D.refreshInstalled()
	} catch (error) {
		await logger.error("读取已安装资源失败:", error)
		toast.error(I18N.value.loadModelsFailed)
	}
}

// 读取当前应用的模型
const loadApplied = async (): Promise<void> => {
	applied.value = await config.get("live2d_model")
}

onMounted(async () => {
	await loadOfficial()
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
	const SUCCESS = await L2D.loadModel(ID)
	if (!SUCCESS) {
		await logger.error(`应用模型失败: ${ID}`)
		toast.error(I18N.value.applyModelFailed)
		return
	}
	await config.set("live2d_model", ID)
	applied.value = ID
}

// 删除模型
const handleDelete = async (): Promise<void> => {
	if (!selected.value) return
	pendingDeleteId.value = selected.value
	showDeleteConfirm.value = true
}

// 待删除模型 id (二次确认弹窗确认后执行)
const pendingDeleteId = ref<string | null>(null)

// 待删除模型的显示名称 (用于确认弹窗文案)
const pendingDeleteDisplayName = computed(() => {
	const id = pendingDeleteId.value
	if (!id) return ""
	return customModels.value.find(m => m.id === id)?.name || id
})

// 删除二次确认弹窗
const showDeleteConfirm = ref(false)

// 确认删除模型
const doDelete = async (): Promise<void> => {
	const ID = pendingDeleteId.value
	showDeleteConfirm.value = false
	pendingDeleteId.value = null
	if (!ID) return
	try {
		await invoke("delete_resource", {resourceType: "live2d", name: ID})
		await logger.info(`删除模型: ${ID}`)
		// 若删除的是当前应用模型, 清理配置, 应用标记与 L2D 状态
		if (applied.value === ID) {
			await config.delete("live2d_model")
			applied.value = null
		}
		selected.value = null
		await loadInstalled()
	} catch (error) {
		await logger.error("删除模型失败:", error)
		toast.error(I18N.value.deleteModelFailed)
	}
}

// 下载/导入状态文案
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

// 导入状态文案
const importStatusText = computed(() => {
	switch (IMPORT.state.step) {
		case "importing":
			return I18N.value.importing
		case "done":
			return I18N.value.importReady
		case "error":
			return IMPORT.state.message || I18N.value.importFailed
		default:
			return ""
	}
})

// 是否正在下载中 (显示进度条)
const showProgress = computed(() =>
	["downloading", "download-done", "extracting"].includes(DOWNLOAD.state.step)
)

// 是否正在导入中 (显示进度条)
const showImportProgress = computed(() =>
	["importing", "error"].includes(IMPORT.state.step)
)

// 进度明细文案 (下载)
const progressText = computed(() => {
	if (DOWNLOAD.state.step !== "downloading") return ""
	return DOWNLOAD.state.total
		? `${formatBytes(DOWNLOAD.state.downloaded ?? 0)} / ${formatBytes(DOWNLOAD.state.total)}`
		: formatBytes(DOWNLOAD.state.downloaded ?? 0)
})

// 进度明细文案 (导入)
const importProgressText = computed(() => {
	if (IMPORT.state.step !== "importing") return ""
	return IMPORT.state.total
		? `${formatBytes(IMPORT.state.processed ?? 0)} / ${formatBytes(IMPORT.state.total)}`
		: formatBytes(IMPORT.state.processed ?? 0)
})

// 下载模型
const handleDownload = async (): Promise<void> => {
	if (!selected.value) return
	const ID = selected.value
	// 涉及 nori 字样的模型需先通过验证问答 (特殊授权保护)
	if (ID.toLowerCase().includes("nori")) {
		pendingDownloadId.value = ID
		showGate.value = true
		return
	}
	await DOWNLOAD.ensure("live2d", ID)
}

// 特殊模型授权验证弹窗 (内容见 ModelGate.vue)
const showGate = ref(false)

// 待下载模型 ID (验证通过后触发下载)
const pendingDownloadId = ref<string | null>(null)

// ModelGate 授权验证通过后触发下载
const onGateConfirm = (modelId: string): void => {
	void DOWNLOAD.ensure("live2d", modelId)
}

// 双击
const handleDblClick = async () => {
	if (selectedInstalled.value) {
		await handleApply()
	} else {
		await handleDownload()
	}
}

// 导入模型弹窗 (选择导入方式)
const showImportDialog = ref(false)

const closeImportDialog = (): void => {
	showImportDialog.value = false
}

// 打开导入方式弹窗 (原直接选目录, 现增强为可选导入方式)
const handleImport = (): void => {
	showImportDialog.value = true
}

// 选择目录后执行导入
const runImport = async (sourcePath: string, sourceType: "dir" | "zip" | "model"): Promise<void> => {
	closeImportDialog()
	try {
		await IMPORT.importModel(sourcePath, sourceType)
	} catch (error) {
		await logger.error("导入操作失败:", error)
		toast.error(I18N.value.importFailed)
	}
}

// 方式一: 导入模型文件夹
const pickImportFolder = async (): Promise<void> => {
	const DIR = await open({
		directory: true,
		multiple: false,
		title: I18N.value.importTypeFolder,
	})
	if (!DIR) return
	const SOURCE = Array.isArray(DIR) ? DIR[0] : DIR
	await runImport(SOURCE, "dir")
}

// 方式二: 导入模型 zip
const pickImportZip = async (): Promise<void> => {
	const FILE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.importTypeZip,
		filters: [{name: "Live2D 模型压缩包", extensions: ["zip"]}],
	})
	if (!FILE) return
	const PATH = Array.isArray(FILE) ? FILE[0] : FILE
	await runImport(PATH, "zip")
}

// 方式三: 导入单个入口 json (model.json / model3.json)
const pickImportModel = async (): Promise<void> => {
	const FILE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.importTypeModel,
		filters: [{name: "Live2D 入口文件", extensions: ["json"]}],
	})
	if (!FILE) return
	const PATH = Array.isArray(FILE) ? FILE[0] : FILE
	await runImport(PATH, "model")
}

// 下载/解压进入完成态 (done/installed) 时刷新已安装列表
watch(() => DOWNLOAD.state.step, (step) => {
	if (step === "done" || step === "installed") {
		void loadInstalled()
	}
})

// 导入完成 (done) 时刷新已安装列表
watch(() => IMPORT.state.step, (step) => {
	if (step === "done") {
		void loadInstalled()
	}
})

// 当前选中模型的显示名称 (用于导出文件名; 找不到时回落模型 id)
const selectedModelName = computed(() => {
	const id = selected.value
	if (!id) return ""
	return customAll.value.find(m => m.id === id)?.name || id
})

// 导出当前选中模型的配置文件
const handleExportConfig = async (): Promise<void> => {
	if (!selected.value) return
	const ID = selected.value
	// 导出文件名默认用模型显示名称 (用模型名称命名), 无显示名时回落 id
	const BASE = selectedModelName.value || ID
	const TARGET = await save({
		title: I18N.value.exportConfig,
		defaultPath: `${BASE}.config.json`,
		filters: [{name: "DeepEr 模型配置", extensions: ["json"]}],
	})
	if (!TARGET) return
	try {
		await invoke("export_model_config", {name: ID, targetPath: TARGET})
		toast.success(I18N.value.exportConfigDone)
		await logger.info(`导出模型配置: ${ID} -> ${TARGET}`)
	} catch (error) {
		await logger.error("导出模型配置失败:", error)
		toast.error(I18N.value.exportConfigFailed)
	}
}

// 导入配置文件到当前选中模型 (导入后写为 model.config.json)
const handleImportConfig = async (): Promise<void> => {
	if (!selected.value) return
	const ID = selected.value
	const SOURCE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.importConfig,
		filters: [{name: "DeepEr 模型配置", extensions: ["json"]}],
	})
	if (!SOURCE) return
	const PATH = Array.isArray(SOURCE) ? SOURCE[0] : SOURCE
	try {
		await invoke("import_model_config", {name: ID, sourcePath: PATH})
		toast.success(I18N.value.importConfigDone)
		await logger.info(`导入模型配置: ${ID} <- ${PATH}`)
		// 导入可能改了显示名/图标, 刷新列表
		await loadInstalled()
	} catch (error) {
		await logger.error("导入模型配置失败:", error)
		toast.error(I18N.value.importConfigFailed)
	}
}

onBeforeUnmount(() => {
	DOWNLOAD.stop()
	IMPORT.stop()
})
</script>
<template>
	<section key="model-select" class="page-model" @click="selected = null">
		<div class="group">
			<div class="group-title">{{ I18N.officialTitle }}</div>
			<div class="cards">
				<template v-if="displayOfficialModels.length">
					<button
						v-for="model in displayOfficialModels"
						:key="model.id"
						class="model-card"
						:class="{selected: selected === model.id}"
						@click.stop="selected = model.id"
						@dblclick="handleDblClick"
					>
						<span class="model-thumb-wrap">
							<img
								v-if="model.coverUrl && !isCoverBroken(model.id)"
								:src="model.coverUrl"
								class="model-thumb"
								alt=""
								loading="lazy"
								@error="markCoverBroken(model.id)"
							/>
							<span v-else class="model-thumb model-placeholder">
								<icon name="cube" :size="42"/>
							</span>
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
				</template>
				<div v-else class="empty-state">
					<template v-if="officialLoading">
						<div class="card-loading">
							<icon name="loading" :size="22" class="spin"/>
							<span>{{ I18N.officialLoading }}</span>
						</div>
					</template>
					<span v-else>{{ I18N.officialEmpty }}</span>
				</div>
			</div>
		</div>
		<div class="group">
			<div class="group-title">
				{{ I18N.customTitle }}
				<button
					class="import-btn"
					:disabled="IMPORT.state.step === 'importing'"
					@click.stop="handleImport"
				>
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
						@dblclick="handleDblClick"
					>
						<span class="model-thumb-wrap">
							<img
								v-if="model.image && !isIconBroken(model.id) && iconUrl(model.id, model.image)"
								:src="iconUrl(model.id, model.image)!"
								class="model-thumb"
								alt=""
								loading="lazy"
								@error="markIconBroken(model.id)"
							/>
							<span v-else class="model-thumb model-placeholder">
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
		<footer
			class="action-bar"
			:class="{raised: !!selected || showProgress || showImportProgress}"
			@click.stop
		>
			<template v-if="showImportProgress">
				<div class="bar-download">
					<ProgressBar :percent="IMPORT.state.percent" :text="importProgressText || ''"/>
					<span class="download-status">{{ importStatusText }}</span>
				</div>
			</template>
			<template v-else-if="showProgress">
				<div class="bar-download">
					<ProgressBar :percent="DOWNLOAD.state.percent" :text="progressText || ''"/>
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
				<button v-if="selectedInstalled" class="bar-btn" @click.stop="handleExportConfig">
					{{ I18N.exportConfig }}
				</button>
				<button v-if="selectedInstalled" class="bar-btn" @click.stop="handleImportConfig">
					{{ I18N.importConfig }}
				</button>
				<button v-if="!selectedInstalled" class="bar-btn" @click.stop="handleDownload">
					{{ I18N.download }}
				</button>
			</template>
		</footer>
		<Teleport to="body">
			<Transition name="import">
				<div v-if="showImportDialog" class="import-overlay" @click.self="closeImportDialog">
					<div class="import-dialog">
						<header class="import-head">
							<h3 class="import-title">{{ I18N.importDialogTitle }}</h3>
							<button class="import-close" @click="closeImportDialog">✕</button>
						</header>
						<div class="import-options">
							<!-- 方式一: 文件夹 -->
							<button class="import-option" @click="pickImportFolder">
								<span class="import-option-name">{{ I18N.importTypeFolder }}</span>
								<span class="import-option-desc">{{ I18N.importTypeFolderDesc }}</span>
							</button>
							<!-- 方式二: zip -->
							<button class="import-option" @click="pickImportZip">
								<span class="import-option-name">{{ I18N.importTypeZip }}</span>
								<span class="import-option-desc">{{ I18N.importTypeZipDesc }}</span>
							</button>
							<!-- 方式三: 单入口 json -->
							<button class="import-option" @click="pickImportModel">
								<span class="import-option-name">{{ I18N.importTypeModel }}</span>
								<span class="import-option-desc">{{ I18N.importTypeModelDesc }}</span>
							</button>
						</div>
						<footer class="import-actions">
							<button class="import-cancel" @click="closeImportDialog">{{ I18N.importClose }}</button>
						</footer>
					</div>
				</div>
			</Transition>
		</Teleport>
		<ModelGate
			v-model:open="showGate"
			:model-id="pendingDownloadId"
			@confirm="onGateConfirm"
		/>
		<ConfirmDialog
			v-model:open="showDeleteConfirm"
			:title="I18N.deleteConfirmTitle"
			:message="I18N.deleteConfirmMessage(pendingDeleteDisplayName)"
			:confirm-text="I18N.delete"
			danger
			@confirm="doDelete"
		/>
	</section>
</template>

<style scoped lang="less">
.page-model {
	position: relative;
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	overflow-y: auto;
}

.group {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;

	.group-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		color: var(--text-body);
		font-size: 1.3rem;
		font-weight: 600;
		letter-spacing: 0.03rem;

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

			&:hover:not(:disabled) {
				background-color: rgba(125, 227, 255, 0.1);
				color: var(--deep-teal-bright);
			}

			&:disabled {
				cursor: default;
				opacity: 0.5;
			}
		}
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: 1.4rem;

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
				border-color: var(--deep-teal-soft);
				transform: translateY(-0.2rem);
			}

			&.selected {
				border-color: var(--deep-teal);
				background-color: rgba(125, 227, 255, 0.1);
				box-shadow: 0 0 1.6rem var(--glow-teal-soft);
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
						background-color: var(--deep-teal);
						border-color: var(--deep-teal);
						color: #05121a;
						transform: scale(1);
					}
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

				.status-badge {
					padding: 0.15rem 0.6rem;
					font-size: 1rem;
					border-radius: 99.9rem;
					border: 0.1rem solid currentColor;

					&.installed {
						color: var(--deep-teal-soft);
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

		.card-loading {
			display: inline-flex;
			align-items: center;
			gap: 0.7rem;
			color: var(--text-faint);
			font-size: 1.15rem;
		}

		.spin {
			animation: card-spin 1s linear infinite;
		}

		@keyframes card-spin {
			to {
				transform: rotate(360deg);
			}
		}
	}
}

.action-bar {
	position: sticky;
	left: 0;
	bottom: 0;
	width: 100%;
	margin-top: auto;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	transform: translateY(100%);
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

	&.raised {
		padding: 1.1rem 2rem;
		border-top: 0.1rem solid var(--line-subtle);
		background-color: rgba(5, 14, 26, 0.6);
		backdrop-filter: blur(0.6rem);
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
		color: var(--deep-teal-bright);
	}

	&:disabled {
		cursor: default;
		opacity: 0.4;
	}

	&.apply {
		border: none;
		color: #05121a;
		background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));

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

.import-overlay {
	position: fixed;
	padding: 2rem;
	inset: 0;
	z-index: 9999;
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: rgba(5, 7, 10, 0.72);
	backdrop-filter: blur(0.4rem);
}

.import-dialog {
	padding: 1.5rem 1.7rem 1.2rem;
	width: min(44rem, 100%);
	display: flex;
	flex-direction: column;
	gap: 1.2rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-md);
	background: linear-gradient(160deg, var(--bg-panel), var(--bg-abyss));
	box-shadow: var(--shadow-soft), 0 0 3rem var(--glow-teal-soft);
}

.import-head {
	display: flex;
	align-items: center;
	justify-content: space-between;

	.import-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--deep-teal-bright);
	}
}

.import-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.2rem;
	height: 2.2rem;
	border: none;
	border-radius: 50%;
	background-color: transparent;
	color: var(--text-faint);
	font-size: 1.3rem;
	line-height: 1;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(251, 44, 54, 0.12);
		color: var(--danger);
	}
}

.import-options {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;

	.import-option {
		padding: 1rem 1.2rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: var(--radius-sm);
		background-color: rgba(255, 255, 255, 0.04);
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			border-color: var(--deep-teal-soft);
			background-color: rgba(125, 227, 255, 0.1);
			transform: translateY(-0.1rem);
		}

		.import-option-name {
			font-size: 1.3rem;
			font-weight: 600;
			color: var(--text-primary);
		}

		.import-option-desc {
			font-size: 1.05rem;
			line-height: 1.6;
			color: var(--text-muted);
		}
	}
}

.import-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;

	.import-cancel {
		padding: 0.7rem 1.5rem;
		border: 0.1rem solid var(--line-strong);
		border-radius: var(--radius-sm);
		background-color: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 1.2rem;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			color: var(--text-body);
			background-color: rgba(255, 255, 255, 0.04);
		}
	}
}

.import-enter-active,
.import-leave-active {
	transition: opacity 0.2s ease;
}

.import-enter-active .import-dialog,
.import-leave-active .import-dialog {
	transition: transform 0.2s ease;
}

.import-enter-from,
.import-leave-to {
	opacity: 0;
}

.import-enter-from .import-dialog,
.import-leave-to .import-dialog {
	transform: translateY(0.6rem) scale(0.98);
}
</style>
