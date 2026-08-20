<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {open} from "@tauri-apps/plugin-dialog"
import {toast} from "vue3-toastify"
import {logger} from "../../services/logger"
import {config} from "../../services/config"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {createResourceDownload, formatBytes} from "../../services/resourceDownload"
import {createResourceImport} from "../../services/resourceImport"
import {useLive2DStore} from "../../services/store/live2d.ts"
import Icon from "../Icon.vue"
import ProgressBar from "../ProgressBar.vue"

const I18N = computed(() => useLanguages().components.main.modelSelect)

const L2D = useLive2DStore()

// 官方模型 (来自后端 /live2d/list)
const officialModels = ref<Live2dModel[]>([])

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
	name: string
}

// 自定义区展示: 已安装自定义模型 (按 id 去重)
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
	try {
		const LIST = await invoke<Live2dModel[]>("fetch_live2d_list")
		if (Array.isArray(LIST)) officialModels.value = LIST
		sessionStorage.setItem("officialModels", JSON.stringify(LIST))
	} catch (error) {
		await logger.error("拉取 Live2D 模型列表失败", error)
		toast.error(I18N.value.loadModelsFailed)
	}
}

// 已安装模型 (来自本地索引)
interface InstalledLive2dModel {
	name: string
	size: number
	entryFile?: string | null
	isOfficial?: boolean
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
		// 自定义模型 = 索引里标记为用户导入的 (is_official = false)
		customModels.value = LIST
			.filter(item => !item.isOfficial)
			.map(item => ({id: item.name, name: item.name}))
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
	const ID = selected.value
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
		gateAnswer.value = ""
		gateError.value = ""
		showGate.value = true
		return
	}
	await DOWNLOAD.ensure("live2d", ID)
}

// 特殊模型授权验证弹窗
const showGate = ref(false)

// 验证答案
const gateAnswer = ref("")

// 验证错误提示
const gateError = ref("")

// 验证提交状态
const gateSubmitting = ref(false)

// 待下载模型 ID (验证通过后触发下载)
const pendingDownloadId = ref<string | null>(null)

// 正确校验答案
const GATE_ANSWER = "水母是水里的月亮"

// 关闭验证弹窗
const closeGate = (): void => {
	showGate.value = false
	gateAnswer.value = ""
	gateError.value = ""
	pendingDownloadId.value = null
}

// 提交验证答案
const submitGate = async (): Promise<void> => {
	if (gateSubmitting.value) return
	const ANSWER = gateAnswer.value.trim()
	if (ANSWER !== GATE_ANSWER) {
		gateError.value = I18N.value.gate.wrong
		return
	}
	const ID = pendingDownloadId.value
	closeGate()
	if (ID) {
		gateSubmitting.value = true
		try {
			await DOWNLOAD.ensure("live2d", ID)
		} finally {
			gateSubmitting.value = false
		}
	}
}

// 双击
const handleDblClick = async () => {
	if (selectedInstalled.value) {
		await handleApply()
	} else {
		await handleDownload()
	}
}

// 导入模型: 选择目录 → 触发后端命令 (结果通过 resource-import 事件推进, done 时刷新列表)
const handleImport = async (): Promise<void> => {
	try {
		const DIR = await open({
			directory: true,
			multiple: false,
			title: I18N.value.selectFolder,
		})
		if (!DIR) return
		const SOURCE = Array.isArray(DIR) ? DIR[0] : DIR
		await IMPORT.importModel(SOURCE)
	} catch (error) {
		await logger.error("导入操作失败:", error)
		toast.error(I18N.value.importFailed)
	}
}

// 下载/解压进入完成态 (done/installed) 时刷新已安装列表
watch(
	() => DOWNLOAD.state.step,
	(step) => {
		if (step === "done" || step === "installed") {
			void loadInstalled()
		}
	}
)

// 导入完成 (done) 时刷新已安装列表
watch(
	() => IMPORT.state.step,
	(step) => {
		if (step === "done") {
			void loadInstalled()
		}
	}
)

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
				<button v-if="!selectedInstalled" class="bar-btn" @click.stop="handleDownload">
					{{ I18N.download }}
				</button>
			</template>
		</footer>
		<!-- 特殊模型授权验证弹窗 (自绘, Teleport 到 body, 不依赖浏览器原生弹窗) -->
		<Teleport to="body">
		<Transition name="gate">
			<div v-if="showGate" class="gate-overlay" @click.self="closeGate">
				<div class="gate-panel">
					<header class="gate-head">
						<h3 class="gate-title">{{ I18N.gate.title }}</h3>
						<button class="gate-close" @click="closeGate">✕</button>
					</header>
					<p class="gate-desc">{{ I18N.gate.desc }}</p>
					<label class="gate-question">{{ I18N.gate.question }}</label>
					<input
						v-model="gateAnswer"
						class="gate-input"
						type="text"
						:placeholder="I18N.gate.placeholder"
						autocomplete="off"
						@keyup.enter="submitGate"
					/>
					<p v-if="gateError" class="gate-error">{{ gateError }}</p>
					<footer class="gate-actions">
						<button class="gate-btn ghost" @click="closeGate">{{ I18N.gate.cancel }}</button>
						<button class="gate-btn primary" :disabled="!gateAnswer.trim()" @click="submitGate">
							{{ I18N.gate.submit }}
						</button>
					</footer>
					<p class="gate-foot">{{ I18N.gate.foot }}</p>
				</div>
			</div>
		</Transition>
	</Teleport>
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

.gate-overlay {
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

.gate-panel {
	padding: 1.6rem 1.8rem 1.3rem;
	width: min(40rem, 100%);
	display: flex;
	flex-direction: column;
	gap: 1rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-md);
	background: linear-gradient(160deg, var(--bg-panel), var(--bg-abyss));
	box-shadow: var(--shadow-soft), 0 0 3rem var(--glow-teal-soft);
}

.gate-head {
	display: flex;
	align-items: center;
	justify-content: space-between;

	.gate-title {
		margin: 0;
		font-size: 1.55rem;
		font-weight: 700;
		color: var(--deep-teal-bright);
	}

	.gate-close {
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
}

.gate-desc {
	margin: 0;
	font-size: 1.15rem;
	line-height: 1.7;
	color: var(--text-body);

	b {
		color: var(--deep-teal-bright);
		font-weight: 600;
	}
}

.gate-question {
	font-size: 1.2rem;
	font-weight: 600;
	color: var(--text-primary);
	letter-spacing: 0.02rem;
}

.gate-input {
	padding: 0.7rem 1rem;
	width: 100%;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-primary);
	font-family: inherit;
	font-size: 1.15rem;
	transition: all 0.2s ease;

	&::placeholder {
		color: var(--text-faint);
	}

	&:focus {
		outline: none;
		border-color: var(--deep-teal);
		box-shadow: 0 0 0 0.25rem var(--glow-teal-soft);
	}
}

.gate-error {
	margin: -0.4rem 0 0;
	font-size: 1.05rem;
	color: var(--danger);
}

.gate-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.9rem;

	.gate-btn {
		padding: 0.7rem 1.6rem;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: 1.2rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;

		&.ghost {
			border: 0.1rem solid var(--line-strong);
			background-color: transparent;
			color: var(--text-muted);

			&:hover {
				border-color: var(--line-strong);
				color: var(--text-body);
				background-color: rgba(255, 255, 255, 0.04);
			}
		}

		&.primary {
			border: none;
			color: #05121a;
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));

			&:hover:not(:disabled) {
				box-shadow: 0 0 1.4rem var(--glow-teal-soft);
			}

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
	}
}

.gate-foot {
	padding-top: 0.7rem;
	margin: 0;
	border-top: 0.1rem solid var(--line-subtle);
	font-size: 1.05rem;
	line-height: 1.6;
	color: var(--text-faint);
}

.gate-enter-active,
.gate-leave-active {
	transition: opacity 0.2s ease;
}

.gate-enter-active .gate-panel,
.gate-leave-active .gate-panel {
	transition: transform 0.2s ease;
}

.gate-enter-from,
.gate-leave-to {
	opacity: 0;
}

.gate-enter-from .gate-panel,
.gate-leave-to .gate-panel {
	transform: translateY(0.6rem) scale(0.98);
}
</style>
