<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {open, save} from "@tauri-apps/plugin-dialog"
import {logger} from "../../services/logger"
import {assetUrl} from "../../services/asset"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {useLive2DStore} from "../../services/store/live2d.ts"
import {useUnsavedGuard} from "../../services/store/unsaved.ts"
import Icon from "../common/Icon.vue"
import SectionCard from "../common/SectionCard.vue"

const props = defineProps<{modelId: string}>()

const emit = defineEmits<{(e: "close"): void}>()

const I18N = computed(() => useLanguages().components.main.modelConfig)

const L2D = useLive2DStore()

const GUARD = useUnsavedGuard()

// 配置页当前模型名
const currentId = ref(props.modelId)

// 草稿: 模型显示名称
const draftName = ref("")

// 草稿: 封面图片
const draftImage = ref("")

// 草稿: 缩放比例
const draftScale = ref(1.0)

// 草稿: 模型在画布上的 X 坐标
const draftPosX = ref(0.0)

// 草稿: 模型在画布上的 Y 坐标
const draftPosY = ref(0.0)

// 草稿: 模型整体旋转角度 (度)
const draftRotation = ref(0.0)

// 草稿: 模型质量
const draftQuality = ref(1.0)


// 打开时从持久化配置读取, 作为"未进入编辑前的状态"
const initial = ref({
	name: "",
	image: "",
	scale: 1.0,
	posX: 0.0,
	posY: 0.0,
	rotation: 0.0,
	quality: 1.0,
})

// 是否有未保存的修改
const hasUnsaved = computed(() =>
	draftName.value !== initial.value.name ||
	draftImage.value !== initial.value.image ||
	Math.abs(draftScale.value - initial.value.scale) > 1e-6 ||
	Math.abs(draftPosX.value - initial.value.posX) > 1e-6 ||
	Math.abs(draftPosY.value - initial.value.posY) > 1e-6 ||
	Math.abs(draftRotation.value - initial.value.rotation) > 1e-6 ||
	Math.abs(draftQuality.value - initial.value.quality) > 1e-6
)

// 确保右侧主画布展示的是当前配置的模型 (配置页调整作用于它)
const ensureModel = async () => {
	try {
		if (!L2D.l2dInstance) return
		if (L2D.currentModel !== props.modelId) await L2D.loadModel(props.modelId)
	} catch (error) {
		await logger.error("加载配置预览模型失败:", error)
	}
}

// 从 L2D 配置提取快照对象 (进入时的初始状态用)
const snapshotFromConfig = () => ({
	name: L2D.config.name,
	image: L2D.config.image,
	scale: L2D.config.render.scale || 1.0,
	posX: L2D.config.render.posX || 0.0,
	posY: L2D.config.render.posY || 0.0,
	rotation: L2D.config.render.rotation || 0.0,
	quality: Number.isFinite(L2D.quality) ? L2D.quality : 1.0,
})

// 从 store 配置装载草稿
const syncFromConfig = () => {
	const S = snapshotFromConfig()
	draftName.value = S.name
	draftImage.value = S.image
	draftScale.value = S.scale
	draftPosX.value = S.posX
	draftPosY.value = S.posY
	draftRotation.value = S.rotation
	draftQuality.value = S.quality
}

// 从 store 配置装载草稿 (进入时)
const loadDraft = async () => {
	if (L2D.configModelName !== currentId.value) {
		await L2D.loadConfig(currentId.value)
	}
	syncFromConfig()
	// 记录进入配置页时的初始快照 (用于未保存改动回滚画布)
	initial.value = {...snapshotFromConfig()}
	// 打开配置页时按已保存质量还原渲染分辨率
	L2D.previewQuality(draftQuality.value)
}

// 把当前草稿应用到右侧画布 (实时预览, 不落盘)
const applyToCanvas = () => {
	L2D.l2dInstance?.setScale(draftScale.value)
	L2D.l2dInstance?.setPosition(draftPosX.value, draftPosY.value)
	L2D.previewRotation(draftRotation.value)
	L2D.previewQuality(draftQuality.value)
}

// 滑块事件: 拖动时实时预览, 值随 v-model 更新
const onScaleInput = () => applyToCanvas()

// 滑块事件: 拖动时实时预览, 值随 v-model 更新
const onPosInput = () => applyToCanvas()

// 滑块事件: 拖动时实时预览, 值随 v-model 更新
const onRotationInput = () => applyToCanvas()

// 滑块事件: 拖动时实时预览, 值随 v-model 更新
const onQualityInput = () => applyToCanvas()

// 计算滑块已填充比例样式 (用于轨道前段高亮)
const rangeStyle = (min: number, max: number, val: number) => {
	const P = Math.min(1, Math.max(0, (val - min) / (max - min)))
	return {
		"--range-pct": `${P * 100}%`,
		background: `linear-gradient(90deg, var(--deep-teal-bright) var(--range-pct), rgba(255,255,255,0.12) var(--range-pct))`,
	} as Record<string, string>
}

// 封面预览 URL
const coverUrl = computed<string | null>(() => {
	const IMAGE = draftImage.value
	if (!IMAGE) return null
	const CLEAN = IMAGE.replace(/^\/+/, "").replace(/\\/g, "/")
	if (!CLEAN || CLEAN.startsWith("/")) return null
	const SEGMENTS = CLEAN.split("/")
	if (SEGMENTS.some(seg => seg === ".." || seg === "." || !seg)) return null
	return `${assetUrl(`live2d/${currentId.value}`)}/${CLEAN}`
})

// 上传封面图片: 复制进模型目录并写入草稿
const pickCover = async () => {
	const FILE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.coverPick,
		filters: [{name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"]}],
	})
	if (!FILE) return
	const PATH = Array.isArray(FILE) ? FILE[0] : FILE
	try {
		const REL = await invoke<string>("save_model_cover", {name: currentId.value, sourcePath: PATH})
		draftImage.value = REL
		await logger.info(`上传模型封面: ${currentId.value} <- ${REL}`)
	} catch (error) {
		await logger.error("上传模型封面失败:", error)
	}
}

// 移除封面: 仅清空草稿, 勾选"未保存改动"; 真正删除磁盘上的封面文件延后到保存(coreSave)成功且封面确为空时执行
const removeCover = () => {
	draftImage.value = ""
}

// 一次保存全部字段 (名称/封面/渲染/质量), 不退出. 成功更新初始快照, 返回是否成功
const coreSave = async (): Promise<boolean> => {
	// 记录保存前的旧封面 (用于判定本次是否"移除了封面", 决定是否删除磁盘封面文件)
	const previousImage = L2D.config.image
	L2D.config.name = draftName.value.trim()
	L2D.config.image = draftImage.value
	L2D.config.render = {scale: draftScale.value, posX: draftPosX.value, posY: draftPosY.value, rotation: draftRotation.value}
	L2D.config.quality = draftQuality.value
	const OK = await L2D.saveConfig()
	if (OK) {
		// 移除封面后真正删除磁盘文件: 保存在旧封面非空、新封面为空时执行.
		// (放在保存成功后, 避免"放弃修改"导致磁盘文件被删而配置仍指向旧封面的 404 / 不可逆丢失)
		if (previousImage && !draftImage.value) {
			try {
				await invoke("delete_model_cover", {name: currentId.value})
				await logger.info(`删除模型封面文件: ${currentId.value}`)
			} catch (error) {
				await logger.error("删除模型封面文件失败:", error)
			}
		}
		initial.value = {...snapshotFromConfig()}
		await logger.info(`保存模型配置: ${currentId.value}`)
	} else {
		await logger.error(`保存模型配置失败: ${currentId.value}`)
	}
	return OK
}

// 保存并退出编辑界面: 回到模型列表, 列表展示新的名称/封面等即为"已生效"的反馈
const saveAndExit = async () => {
	const OK = await coreSave()
	if (!OK) return
	emit("close")
}

// 导入/导出配置的页面状态提示 (success: 主题色, error: 红色)
const importExportMsg = ref<{isError: boolean; text: string} | null>(null)

// 导出当前模型的配置文件 (.config.json)
const handleExportConfig = async (): Promise<void> => {
	// 清除上次状态
	importExportMsg.value = null
	// 先落一次当前草稿, 保证导出的是最新配置
	await coreSave()
	const TARGET = await save({
		title: I18N.value.exportConfig,
		defaultPath: `${currentId.value}.config.json`,
		filters: [{name: "DeepEr 模型配置", extensions: ["json"]}],
	})
	if (!TARGET) return
	try {
		await invoke("export_model_config", {name: currentId.value, targetPath: TARGET})
		importExportMsg.value = {isError: false, text: I18N.value.exportConfigDone}
		await logger.info(`导出模型配置: ${currentId.value} -> ${TARGET}`)
	} catch (error) {
		await logger.error("导出模型配置失败:", error)
		importExportMsg.value = {isError: true, text: I18N.value.exportConfigFailed}
	}
}

// 从配置文件恢复当前模型的配置 (导入后重载草稿并刷新画布预览)
const handleImportConfig = async (): Promise<void> => {
	// 清除上次状态
	importExportMsg.value = null
	const SOURCE = await open({
		multiple: false,
		directory: false,
		title: I18N.value.importConfig,
		filters: [{name: "DeepEr 模型配置", extensions: ["json"]}],
	})
	if (!SOURCE) return
	const PATH = Array.isArray(SOURCE) ? SOURCE[0] : SOURCE
	try {
		await invoke("import_model_config", {name: currentId.value, sourcePath: PATH})
		importExportMsg.value = {isError: false, text: I18N.value.importConfigDone}
		await logger.info(`导入模型配置: ${currentId.value} <- ${PATH}`)
		await L2D.loadConfig(currentId.value)
		syncFromConfig()
		applyToCanvas()
		// 刷新"未保存改动"基准, 避免导入后误判存在改动
		initial.value = {...snapshotFromConfig()}
	} catch (error) {
		await logger.error("导入模型配置失败:", error)
		importExportMsg.value = {isError: true, text: I18N.value.importConfigFailed}
	}
}

// 放弃未保存改动: 草稿与画布都恢复到进入配置页时的状态 (模型立即复原清晰)
const rollback = () => {
	const S = initial.value
	draftName.value = S.name
	draftImage.value = S.image
	draftScale.value = S.scale
	draftPosX.value = S.posX
	draftPosY.value = S.posY
	draftRotation.value = S.rotation
	draftQuality.value = S.quality
	applyToCanvas()
}

// 离开守卫: 有未保存改动时统一询问保存/放弃, 覆盖 back 按钮与主界面导航离开
const GUARD_SYNC = () => ({
	hasUnsaved: () => hasUnsaved.value,
	onSave: async () => coreSave(),
	onDiscard: rollback,
	title: I18N.value.unsavedTitle,
	message: I18N.value.unsavedMessage,
	saveLabel: I18N.value.save,
	discardLabel: I18N.value.discard,
})

// 关闭配置页入口: 有未保存改动时先询问保存/放弃, 否则直接关闭
const requestClose = async () => {
	if (await GUARD.requestLeave()) {
		emit("close")
	}
}

onBeforeUnmount(() => {
	GUARD.unregister()
	if (hasUnsaved.value) {
		// 仅在确有未保存改动时回滚画布
		L2D.l2dInstance?.setScale(initial.value.scale)
		L2D.l2dInstance?.setPosition(initial.value.posX, initial.value.posY)
		L2D.previewRotation(initial.value.rotation)
		L2D.previewQuality(initial.value.quality)
	}
})

// 重置为默认值并立即应用到画布与配置 (留在编辑界面, 画布复原即为反馈)
const resetAll = async () => {
	draftName.value = ""
	draftImage.value = ""
	draftScale.value = 1.0
	draftPosX.value = 0.0
	draftPosY.value = 0.0
	draftRotation.value = 0.0
	draftQuality.value = 1.0
	applyToCanvas()
	await coreSave()
	await logger.info(`重置模型配置为默认: ${currentId.value}`)
}

onMounted(async () => {
	await ensureModel()
	await loadDraft()
	// 注册离开守卫: back 按钮与主界面导航 (路由/侧边栏) 离开前统一询问
	GUARD.register(GUARD_SYNC())
})
</script>

<template>
	<section class="page-model-config">
		<header class="cfg-top">
			<div class="cfg-top-left">
				<button class="back-btn" :title="I18N.back" @click="requestClose">
					<Icon name="close" :size="15"/>
				</button>
				<h2 class="cfg-title">{{ I18N.title }}</h2>
				<span class="cfg-model-tag">{{ currentId }}</span>
			</div>
			<div class="cfg-top-right">
				<button class="top-btn ghost" :title="I18N.exportConfig" @click="handleExportConfig">
					<Icon name="folder" :size="15"/>
					<span>{{ I18N.exportConfig }}</span>
				</button>
				<button class="top-btn ghost" :title="I18N.importConfig" @click="handleImportConfig">
					<Icon name="import" :size="15"/>
					<span>{{ I18N.importConfig }}</span>
				</button>
				<button class="top-btn ghost" @click="resetAll">
					<Icon name="refresh" :size="15"/>
					<span>{{ I18N.reset }}</span>
				</button>
				<button class="top-btn primary" :title="I18N.save" @click="saveAndExit">
					<Icon name="check" :size="16"/>
					<span>{{ I18N.save }}</span>
				</button>
			</div>
		</header>
		<div v-if="importExportMsg" class="cfg-status" :class="{error: importExportMsg.isError}">
			{{ importExportMsg.text }}
		</div>
		<div class="cfg-sheet">
			<!-- 外观 -->
			<SectionCard icon="cube" :title="I18N.appearanceTitle">
					<div class="field">
						<label class="field-label">{{ I18N.name }}</label>
						<input v-model="draftName" class="field-input" :placeholder="I18N.namePlaceholder"/>
						<p class="field-hint">{{ I18N.nameHint }}</p>
					</div>
					<div class="field">
						<label class="field-label">{{ I18N.cover }}</label>
						<div class="cover-row">
							<button class="cover-thumb" :class="{filled: !!coverUrl}" :title="I18N.uploadCover" @click="pickCover">
								<img v-if="coverUrl" :src="coverUrl" class="cover-img" alt=""/>
								<span v-else class="cover-empty"><Icon name="import" :size="18"/></span>
							</button>
							<div class="cover-actions">
								<button class="mini-btn" @click="pickCover">
									<Icon name="import" :size="14"/>
									<span>{{ I18N.uploadCover }}</span>
								</button>
								<button v-if="draftImage" class="mini-btn danger" @click="removeCover">
									<Icon name="close" :size="14"/>
									<span>{{ I18N.removeCover }}</span>
								</button>
							</div>
						</div>
						<p class="field-hint">{{ I18N.coverHint }}</p>
					</div>
			</SectionCard>
			<!-- 渲染 -->
			<SectionCard icon="resize" :title="I18N.renderTitle" :subtitle="I18N.renderHint">
					<div class="slider-field">
						<div class="slider-meta">
							<span class="slider-name">{{ I18N.scale }}</span>
							<span class="slider-val">{{ draftScale.toFixed(2) }}</span>
						</div>
						<input
							v-model.number="draftScale"
							class="range" type="range" min="0.2" max="3" step="0.05"
							:style="rangeStyle(0.2, 3, draftScale)"
							@input="onScaleInput"
						/>
					</div>
					<div class="slider-field">
						<div class="slider-meta">
							<span class="slider-name">{{ I18N.posX }}</span>
							<span class="slider-val">{{ draftPosX.toFixed(2) }}</span>
						</div>
						<input
							v-model.number="draftPosX"
							class="range" type="range" min="-2" max="2" step="0.01"
							:style="rangeStyle(-2, 2, draftPosX)"
							@input="onPosInput"
						/>
					</div>
					<div class="slider-field">
						<div class="slider-meta">
							<span class="slider-name">{{ I18N.posY }}</span>
							<span class="slider-val">{{ draftPosY.toFixed(2) }}</span>
						</div>
						<input
							v-model.number="draftPosY"
							class="range" type="range" min="-2" max="2" step="0.01"
							:style="rangeStyle(-2, 2, draftPosY)"
							@input="onPosInput"
						/>
					</div>
					<div class="slider-field">
						<div class="slider-meta">
							<span class="slider-name">{{ I18N.rotation }}</span>
							<span class="slider-val">{{ draftRotation.toFixed(0) }}°</span>
						</div>
						<input
							v-model.number="draftRotation"
							class="range" type="range" min="0" max="360" step="1"
							:style="rangeStyle(0, 360, draftRotation)"
							@input="onRotationInput"
						/>
						<div class="rot-ticks">
							<span
								v-for="r in [0, 90, 180, 270]"
								:key="r"
								class="rot-tick"
								:class="{active: Math.round(draftRotation) === r}"
								:style="{left: `${(r / 360) * 100}%`}"
							>
								<i class="rot-tick-line"/>
								<b class="rot-tick-label">{{ r }}</b>
							</span>
						</div>
					</div>
			</SectionCard>
			<!-- 显示质量 -->
			<SectionCard icon="settings" :title="I18N.qualityTitle">
					<div class="slider-field">
						<div class="slider-meta">
							<span class="slider-name">{{ I18N.quality }}</span>
							<span class="slider-val">{{ Math.round(draftQuality * 100) }}%</span>
						</div>
						<input
							v-model.number="draftQuality"
							class="range" type="range" min="0.25" max="1" step="0.05"
							:style="rangeStyle(0.25, 1, draftQuality)"
							@input="onQualityInput"
						/>
					</div>
					<p class="field-hint">{{ I18N.qualityHint }}</p>
			</SectionCard>
		</div>
	</section>
</template>

<style scoped lang="less">
.page-model-config {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1.2rem;
}

.cfg-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-shrink: 0;
	gap: 1rem;

	.cfg-top-left {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.9rem;

		.back-btn {
			width: 2.6rem;
			height: 2.6rem;
			flex-shrink: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0.1rem solid var(--line-strong);
			border-radius: 50%;
			background-color: transparent;
			color: var(--text-muted);
			cursor: pointer;
			transition: all 0.2s ease;

			&:hover {
				color: var(--danger);
				border-color: var(--danger);
				background-color: rgba(251, 44, 54, 0.1);
			}
		}
	}

	.cfg-title {
		margin: 0;
		font-size: 1.8rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: var(--glow-text);
		white-space: nowrap;
	}

	.cfg-model-tag {
		padding: 0.2rem 0.7rem;
		max-width: 20rem;
		font-size: 1.05rem;
		border: 0.1rem solid var(--line-strong);
		border-radius: 99.9rem;
		color: var(--deep-teal-soft);
		background-color: rgba(125, 227, 255, 0.06);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cfg-top-right {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-shrink: 0;
	}
}

.top-btn {
	padding: 0.65rem 1.4rem;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	border-radius: var(--radius-sm);
	font: inherit;
	font-size: 1.25rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s ease;

	&.ghost {
		border: 0.1rem solid var(--line-strong);
		background-color: transparent;
		color: var(--text-muted);

		&:hover {
			color: var(--danger);
			border-color: var(--danger);
			background-color: rgba(251, 44, 54, 0.08);
		}
	}

	&.primary {
		border: none;
		color: #05121a;
		background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));

		&:hover {
			box-shadow: 0 0 1.6rem var(--glow-teal-soft);
		}
	}
}

.cfg-status {
	margin-top: -0.3rem;
	padding: 0.45rem 0.9rem;
	width: max-content;
	flex-shrink: 0;
	font-size: 1.1rem;
	border-radius: var(--radius-sm);
	color: var(--deep-teal-bright);
	background-color: rgba(125, 227, 255, 0.1);
	border: 0.1rem solid rgba(125, 227, 255, 0.25);

	&.error {
		color: var(--danger);
		background-color: rgba(251, 44, 54, 0.12);
		border-color: rgba(251, 44, 54, 0.35);
	}
}

.cfg-sheet {
	padding-bottom: 0.5rem;
	flex: 1;
	width: 100%;
	min-height: 0;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
	gap: 1.2rem;
	align-items: start;
	align-content: start;
	overflow-y: auto;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;

	.field-label {
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--text-muted);
	}

	.field-input {
		padding: 0.55rem 0.8rem;
		width: 100%;
		box-sizing: border-box;
		border-radius: var(--radius-sm);
		border: 0.1rem solid var(--line-strong);
		background-color: rgba(5, 14, 26, 0.5);
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
			box-shadow: 0 0 0.9rem var(--glow-teal-soft);
		}
	}
}

.field-hint {
	margin: 0;
	font-size: 1rem;
	line-height: 1.6;
	color: var(--text-faint);
}

.cover-row {
	display: flex;
	align-items: center;
	gap: 1rem;

	.cover-thumb {
		padding: 0;
		width: 6.2rem;
		height: 6.2rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0.1rem dashed var(--line-strong);
		border-radius: var(--radius-md);
		background-color: rgba(255, 255, 255, 0.03);
		color: var(--text-faint);
		overflow: hidden;
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			border-color: var(--deep-teal-soft);
			box-shadow: 0 0 0.9rem var(--glow-teal-soft);
		}

		&.filled {
			border-style: solid;
		}

		.cover-img {
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		.cover-empty {
			display: inline-flex;
		}
	}

	.cover-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
}

.mini-btn {
	padding: 0.45rem 0.9rem;
	display: inline-flex;
	align-items: center;
	gap: 0.45rem;
	border: 0.1rem solid var(--line-strong);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-body);
	font: inherit;
	font-size: 1.05rem;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: rgba(125, 227, 255, 0.12);
		color: var(--deep-teal-bright);
		border-color: var(--deep-teal-soft);
	}

	&.danger:hover:not(:disabled) {
		border-color: var(--danger);
		color: var(--danger);
		background-color: rgba(251, 44, 54, 0.1);
	}
}

.slider-field {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;

	.slider-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;

		.slider-name {
			font-size: 1.05rem;
			color: var(--text-muted);
		}

		.slider-val {
			padding: 0.15rem 0.55rem;
			min-width: 3.2rem;
			text-align: right;
			border-radius: 0.5rem;
			font-size: 1.05rem;
			font-variant-numeric: tabular-nums;
			color: var(--deep-teal-bright);
			background-color: rgba(125, 227, 255, 0.1);
			border: 0.1rem solid rgba(125, 227, 255, 0.18);
		}
	}

	.range {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 0.5rem;
		border-radius: 99.9rem;
		background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
		outline: none;
		cursor: pointer;

		&::-webkit-slider-thumb {
			-webkit-appearance: none;
			appearance: none;
			width: 1.5rem;
			height: 1.5rem;
			border-radius: 50%;
			border: 0.18rem solid #05121a;
			background: var(--deep-teal-bright);
			box-shadow: 0 0 0.7rem var(--glow-teal-soft);
			transition: box-shadow 0.15s ease;
		}

		&:hover::-webkit-slider-thumb {
			box-shadow: 0 0 1.2rem var(--glow-teal-soft);
		}

		&::-moz-range-thumb {
			width: 1.5rem;
			height: 1.5rem;
			border-radius: 50%;
			border: 0.18rem solid #05121a;
			background: var(--deep-teal-bright);
			box-shadow: 0 0 0.7rem var(--glow-teal-soft);
		}

		&::-moz-range-track {
			height: 0.5rem;
			border-radius: 99.9rem;
			background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
		}
	}

	.rot-ticks {
		position: relative;
		margin-top: 0.45rem;
		height: 0.45rem;

		.rot-tick {
			position: absolute;
			top: 0;
			transform: translateX(-50%);
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.15rem;
			color: var(--text-faint);

			.rot-tick-line {
				width: 0.1rem;
				height: 0.35rem;
				background-color: var(--line-strong);
			}

			.rot-tick-label {
				font-size: 0.85rem;
				font-weight: 500;
				line-height: 1;
			}

			&.active {
				color: var(--deep-teal-bright);

				.rot-tick-line {
					height: 0.5rem;
					background-color: var(--deep-teal-bright);
				}
			}
		}
	}
}
</style>
