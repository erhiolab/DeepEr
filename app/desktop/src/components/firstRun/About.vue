<script setup lang="ts">
import {computed, ref} from "vue"
import {check} from "@tauri-apps/plugin-updater"
import {relaunch} from "@tauri-apps/plugin-process"
import {openUrl} from "@tauri-apps/plugin-opener"
import {logger} from "../../services/logger"
import useLanguages from "../../services/i18n/useLanguages.ts"
import Icon from "../common/Icon.vue"
import logo from "../../assets/images/logo.png"
import erhiolab from "../../assets/images/erhio.webp"
import QiCaiJie114514 from "../../assets/images/QiCaiJie114514.webp"
import inori from "../../assets/images/inori.png"

const I18N = computed(() => useLanguages().components.firstRun.about)

// 致谢名单
interface Contributor {
	name: string
	role: string
	url?: string
	handle?: string
	avatar?: string
}

// 致谢名单
const CONTRIBUTORS: Contributor[] = [
	{
		name: "洱海 (erhiolab)",
		role: "开发 · 维护",
		url: "https://github.com/erhiolab",
		handle: "@erhiolab",
		avatar: erhiolab
	},
	{
		name: "亓才孑 (QiCaiJie114514)",
		role: "开发 · 维护",
		url: "https://github.com/QiCaiJie114514",
		handle: "@QiCaiJie114514",
		avatar: QiCaiJie114514
	},
	{
		name: "I_NORI 交流群",
		role: "反馈 · 建议",
		avatar: inori
	}
]


// 更新状态
type UpdateStatus =
	| "idle"        // 未检查
	| "checking"    // 检查中
	| "up-to-date"  // 已是最新
	| "updating"    // 正在下载安装
	| "updated"     // 更新完成, 等待重启
	| "failed"      // 更新失败, 可手动更新
	| "error"       // 检查出错
const updateStatus = ref<UpdateStatus>("idle")

// 更新版本号
const updateVersion = ref<string>("")

// 更新错误信息
const updateError = ref<string>("")

// 更新说明
const updateNotes = ref<string>("")

// 新版本信息摘要
const updateSummary = computed(() => {
	if (updateStatus.value === "up-to-date") return ""
	return I18N.value.update.latestVersion.replace("{version}", updateVersion.value)
})

// 手动更新地址 (GitHub Releases)
const RELEASE_URL = "https://github.com/erhiolab/DeepEr/releases"

// 检查更新
const checkForUpdates = async () => {
	// 防止重复点击
	if (updateStatus.value === "checking" || updateStatus.value === "updating") return
	updateStatus.value = "checking"
	updateError.value = ""
	updateVersion.value = ""
	updateNotes.value = ""
	try {
		const update = await check()
		if (!update) {
			// 没有新版本
			updateStatus.value = "up-to-date"
			return
		}
		// 发现新版本
		updateVersion.value = update.version
		updateNotes.value = update.body || ""
		updateStatus.value = "updating"
		// 自动下载并安装
		await update.downloadAndInstall((progressEvent) => {
			if (progressEvent.event === "Started") {
				logger.debug("开始下载更新")
			} else if (progressEvent.event === "Progress") {
				logger.debug(`更新下载中: 本次块 ${progressEvent.data.chunkLength} bytes`)
			} else if (progressEvent.event === "Finished") {
				logger.debug("更新下载完成")
			}
		})
		// 安装完成, 需要重启生效
		updateStatus.value = "updated"
	} catch (error) {
		// 检查或下载失败
		await logger.error("检查更新失败:", error)
		updateError.value = error instanceof Error ? error.message : String(error)
		// 区分: 检查失败 vs 下载安装失败
		if (updateStatus.value === "checking") {
			// 检查阶段就失败
			updateStatus.value = "error"
		} else {
			// 下载安装阶段失败 → 手动更新
			updateStatus.value = "failed"
		}
	}
}

// 重启应用完成更新
const restartToApply = async () => {
	try {
		await relaunch()
	} catch (error) {
		await logger.error("重启应用失败:", error)
		updateError.value = I18N.value.update.restartFailed
		updateStatus.value = "failed"
	}
}

// 跳转到 GitHub Releases 手动下载
const manualUpdate = async () => {
	try {
		await openUrl(RELEASE_URL)
	} catch (error) {
		console.error("打开 GitHub Releases 失败:", error)
	}
}

// 打开外部链接
const openLink = async (url: string) => {
	try {
		await openUrl(url)
	} catch (error) {
		await logger.error("打开链接失败:", error)
	}
}
</script>

<template>
	<section key="about" class="page page-about">
		<div class="about-head">
			<img class="about-logo" :src="logo" alt="DeepEr"/>
			<div class="about-meta">
				<h2 class="about-title glow-teal">{{ I18N.title }}</h2>
				<p class="about-subtitle">{{ I18N.subtitle }}</p>
			</div>
		</div>
		<div class="about-body">
			<p class="thanks-note">{{ I18N.thanksPlaceholder }}</p>
			<div class="contributors">
				<button
					v-for="c in CONTRIBUTORS"
					:key="c.name"
					class="contrib-card"
					:class="{clickable: !!c.url}"
					@click="c.url && openLink(c.url)"
					:title="c.url"
				>
					<img :src="c.avatar" :alt="c.name" class="contrib-avatar"/>
					<span class="contrib-info">
						<span class="contrib-role">{{ c.role }}</span>
						<span class="contrib-name">{{ c.name }}</span>
					</span>
				</button>
			</div>
			<h3 class="block-title">{{ I18N.update.title }}</h3>
			<div class="update-card" :class="`update-${updateStatus}`">
				<div class="update-info">
					<!-- 最新版本 -->
					<span v-if="updateStatus === 'up-to-date'" class="update-version">
						<Icon name="check" :size="14"/>
						{{ I18N.update.upToDate }}
					</span>
					<!-- 发现新版本 -->
					<span v-else-if="updateVersion" class="update-version">
						{{ updateSummary }}
					</span>
					<!-- 更新完成提示 -->
					<span v-if="updateStatus === 'updated'" class="update-done">
						{{ I18N.update.done }}
					</span>
					<!-- 检查出错提示 -->
					<span v-if="updateStatus === 'error'" class="update-error">
						{{ I18N.update.checkFailed }}
					</span>
					<!-- 自动更新失败提示 -->
					<span v-if="updateStatus === 'failed'" class="update-error">
						{{ I18N.update.autoFailed }}
					</span>
					<!-- 更新备注 -->
					<span v-if="updateNotes && (updateStatus === 'updated' || updateStatus === 'failed' || updateStatus === 'error')" class="update-notes">
						{{ updateNotes }}
					</span>
					<!-- 错误详情 -->
					<span v-if="updateError && (updateStatus === 'failed' || updateStatus === 'error')" class="update-error-detail">
						{{ updateError }}
					</span>
					<!-- 默认提示 -->
					<span v-else-if="!updateVersion && updateStatus === 'idle'" class="update-hint">
						{{ I18N.update.hint }}
					</span>
				</div>
				<div class="update-actions">
					<!-- 检查更新 (默认 / 已是最新) -->
					<button
						v-if="updateStatus === 'idle' || updateStatus === 'up-to-date'"
						class="update-btn"
						@click="checkForUpdates"
					>
						{{ I18N.update.check }}
					</button>
					<!-- 检查中 -->
					<button
						v-if="updateStatus === 'checking'"
						class="update-btn"
						disabled
					>
						<Icon name="loading" :size="14"/>
						{{ I18N.update.checking }}
					</button>
					<!-- 检查出错 → 重新检查 -->
					<button
						v-if="updateStatus === 'error'"
						class="update-btn"
						@click="checkForUpdates"
					>
						<Icon name="refresh" :size="14"/>
						{{ I18N.update.retry }}
					</button>
					<!-- 更新完成 → 重启 -->
					<button
						v-if="updateStatus === 'updated'"
						class="update-btn primary"
						@click="restartToApply"
					>
						{{ I18N.update.restart }}
					</button>
					<!-- 自动更新失败 → 手动更新 -->
					<button
						v-if="updateStatus === 'failed'"
						class="update-btn primary"
						@click="manualUpdate"
					>
						<Icon name="arrow-right" :size="14"/>
						{{ I18N.update.manual }}
					</button>
					<!-- 正在下载安装 -->
					<button
						v-if="updateStatus === 'updating'"
						class="update-btn"
						disabled
					>
						<Icon name="loading" :size="14"/>
						{{ I18N.update.updating }}
					</button>
				</div>
			</div>
			<h3 class="block-title">{{ I18N.linksTitle }}</h3>
			<div class="links">
				<button class="link-card" @click="openLink('https://github.com/erhiolab/DeepEr')">
					<span class="link-text">
						<span class="link-label">{{ I18N.source.label }}</span>
						<span class="link-sub">{{ I18N.source.sub }}</span>
					</span>
					<span class="link-arrow">
						<Icon name="arrow-right"/>
					</span>
				</button>
				<button class="link-card" @click="openLink('https://github.com/erhiolab/DeepEr/issues')">
					<span class="link-text">
						<span class="link-label">{{ I18N.issues.label }}</span>
						<span class="link-sub">{{ I18N.issues.sub }}</span>
					</span>
					<span class="link-arrow">
						<Icon name="arrow-right"/>
					</span>
				</button>
			</div>
		</div>
	</section>
</template>

<style scoped lang="less">
.page {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
}

.page-about {
	padding: 1.2rem 5.6rem 1.6rem;
	gap: 1.4rem;
	overflow: hidden;
}

.about-head {
	display: flex;
	align-items: center;
	gap: 1.6rem;
	flex-shrink: 0;
}

.about-logo {
	width: 4.6rem;
	height: 4.6rem;
	object-fit: contain;
	filter: drop-shadow(0 0 1.2rem rgba(94, 234, 212, 0.5));
}

.about-meta {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.about-title {
	font-size: 2.4rem;
	font-weight: 700;
	color: var(--text-primary);
	line-height: 1.2;
}

.about-subtitle {
	font-size: 1.2rem;
	color: var(--text-faint);
}

.about-body {
	flex: 1;
	padding-right: 0.4rem;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.thanks-note {
	margin: 0;
	font-size: 1.15rem;
	line-height: 1.7;
	color: var(--text-body);
}

.contributors {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
	gap: 0.8rem;
}

.contrib-card {
	padding: 0.9rem 1.1rem;
	display: flex;
	align-items: center;
	gap: 0.9rem;
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.04);
	border: 0.1rem solid var(--line-subtle);
	font-family: inherit;
	color: var(--text-primary);
	text-align: left;
	transition: all 0.2s ease;

	&.clickable {
		cursor: pointer;

		&:hover {
			transform: translateY(-0.15rem);
			background-color: rgba(125, 227, 255, 0.1);
			border-color: var(--deep-teal-soft);
			box-shadow: 0 0 1.2rem var(--glow-teal-soft);
		}
	}
}

.contrib-avatar {
	width: 3.2rem;
	height: 3.2rem;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	font-size: 1.7rem;
	border-radius: 50%;
	background-color: rgba(125, 227, 255, 0.1);
	border: 0.1rem solid var(--line-subtle);
}

.contrib-info {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.contrib-role {
	font-size: 1.05rem;
	color: var(--deep-teal);
	font-weight: 500;
}

.contrib-name {
	font-size: 1.2rem;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--text-primary);
}

.block-title {
	margin-top: 0.2rem;
	font-size: 1.3rem;
	font-weight: 600;
	color: var(--deep-teal);
}

.links {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
}

.link-card {
	padding: 0.8rem 1.3rem;
	display: flex;
	align-items: center;
	gap: 1rem;
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.04);
	border: 0.1rem solid var(--line-subtle);
	color: var(--text-primary);
	font-size: 1.3rem;
	font-family: inherit;
	cursor: pointer;
	text-align: left;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.1);
		border-color: var(--deep-teal-soft);
		box-shadow: 0 0 1.2rem var(--glow-teal-soft);
		transform: translateX(0.3rem);
	}
}

.link-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.link-label {
	font-weight: 500;
}

.link-sub {
	font-size: 1.1rem;
	color: var(--text-faint);
}

.link-arrow {
	color: var(--deep-teal);
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;

	:deep(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
}

/* ---------- 更新模块 ---------- */
.update-card {
	padding: 0.8rem 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.04);
	border: 0.1rem solid var(--line-subtle);
	transition: all 0.2s ease;

	&.update-up-to-date {
		border-color: var(--deep-teal-soft);
	}

	&.update-failed,
	&.update-error {
		border-color: rgba(244, 114, 182, 0.5);
		background-color: rgba(244, 114, 182, 0.04);
	}

	&.update-updated {
		border-color: var(--deep-teal-soft);
		background-color: rgba(34, 197, 94, 0.06);
		box-shadow: 0 0 1.2rem var(--glow-teal-soft);
	}
}

.update-info {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	min-height: 1.6rem;
}

.update-version {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 1.2rem;
	font-weight: 600;
	color: var(--text-primary);
}

.update-notes {
	font-size: 1.05rem;
	line-height: 1.5;
	color: var(--text-body);
	word-break: break-word;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.update-error {
	font-size: 1.05rem;
	color: #f472b6;
	line-height: 1.4;
}

.update-error-detail {
	font-size: 1.05rem;
	color: rgba(244, 114, 182, 0.7);
	line-height: 1.4;
	word-break: break-word;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.update-done {
	font-size: 1.1rem;
	font-weight: 600;
	color: #4ade80;
}

.update-hint {
	font-size: 1.05rem;
	color: var(--text-faint);
}

.update-actions {
	display: flex;
	gap: 0.5rem;
	align-items: center;
	flex-wrap: wrap;
	margin-top: 0.2rem;
}

.update-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.4rem 0.9rem;
	border-radius: var(--radius-sm);
	border: 0.1rem solid var(--deep-teal-soft);
	background-color: rgba(125, 227, 255, 0.08);
	color: var(--deep-teal);
	font-size: 1.05rem;
	font-family: inherit;
	font-weight: 500;
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: rgba(125, 227, 255, 0.2);
		border-color: var(--deep-teal);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	&:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	&.primary {
		background-color: rgba(34, 197, 94, 0.15);
		border-color: rgba(34, 197, 94, 0.4);
		color: #4ade80;

		&:hover:not(:disabled) {
			background-color: rgba(34, 197, 94, 0.28);
			border-color: #4ade80;
			box-shadow: 0 0 0.8rem rgba(34, 197, 94, 0.25);
		}
	}

	:deep(svg) {
		width: 1.1rem;
		height: 1.1rem;
	}
}
</style>
