<script setup lang="ts">
import {computed, onMounted} from "vue"
import {openUrl} from "@tauri-apps/plugin-opener"
import useLanguages from "../../services/i18n/useLanguages.ts"
import {useUpdaterStore} from "../../services/store/updater.ts"
import {logger} from "../../services/logger"
import Icon from "../common/Icon.vue"
import logo from "../../assets/images/logo.png"
import erhiolab from "../../assets/images/erhio.webp"
import QiCaiJie114514 from "../../assets/images/QiCaiJie114514.webp"
import inori from "../../assets/images/inori.png"

const I18N = computed(() => useLanguages().components.firstRun.about)

// 更新模块 (独立 store, 状态与方法见 services/store/updater.ts)
const updater = useUpdaterStore()

// 初始化: 拉取当前应用版本号
onMounted(() => {
	void updater.init()
})

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
		role: "开发 ` 维护",
		url: "https://github.com/erhiolab",
		handle: "@erhiolab",
		avatar: erhiolab
	},
	{
		name: "亓才孑 (QiCaiJie114514)",
		role: "开发 ` 维护",
		url: "https://github.com/QiCaiJie114514",
		handle: "@QiCaiJie114514",
		avatar: QiCaiJie114514
	},
	{
		name: "I_NORI 交流群",
		role: "反馈 ` 建议",
		avatar: inori
	}
]

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
			<div class="update-card" :class="`update-${updater.status}`">
				<div class="version-grid">
					<div class="version-cell">
						<span class="version-label">{{ I18N.update.currentVersion }}</span>
						<span class="version-value">v{{ updater.currentVersion || "--" }}</span>
					</div>
					<div class="version-cell">
						<span class="version-label">{{ I18N.update.latestVer }}</span>
						<span
							class="version-value"
							:class="updater.hasUpdate ? 'is-new' : ''"
						>
							<template v-if="updater.availableVersion">v{{ updater.availableVersion }}</template>
							<template v-else-if="updater.status === 'up-to-date'">v{{ updater.currentVersion || "--" }}</template>
							<template v-else>--</template>
						</span>
					</div>
				</div>
				<!-- 状态提示 -->
				<div class="update-status" v-if="updater.status !== 'idle'">
					<!-- 检查中 -->
					<span v-if="updater.status === 'checking'" class="status-text">
						<Icon name="loading" :size="14"/>
						{{ I18N.update.checkingText }}
					</span>
					<!-- 已是最新 -->
					<span v-else-if="updater.status === 'up-to-date'" class="status-text ok">
						<Icon name="check" :size="14"/>
						{{ I18N.update.upToDate }}
					</span>
					<!-- 下载安装中 -->
					<span v-else-if="updater.status === 'updating'" class="status-text">
						<Icon name="loading" :size="14"/>
						{{ I18N.update.updatingText }}
						<span v-if="updater.downloadProgress !== null" class="download-percent">
							{{ updater.downloadProgress }}%
						</span>
					</span>
					<!-- 更新完成 -->
					<span v-else-if="updater.status === 'updated'" class="status-text ok">
						<Icon name="check" :size="14"/>
						{{ I18N.update.done }}
					</span>
					<!-- 检查失败 -->
					<span v-else-if="updater.status === 'error'" class="status-text bad">
						<Icon name="error" :size="14"/>
						{{ I18N.update.checkFailed }}
					</span>
					<!-- 更新失败 -->
					<span v-else-if="updater.status === 'failed'" class="status-text bad">
						<Icon name="error" :size="14"/>
						{{ I18N.update.autoFailed }}
					</span>
				</div>
				<!-- 更新备注 -->
				<div v-if="updater.updateNotes && (updater.status === 'updated' || updater.status === 'failed')" class="update-notes">
					{{ updater.updateNotes }}
				</div>
				<!-- 错误详情 -->
				<div v-if="updater.updateError && (updater.status === 'failed' || updater.status === 'error')" class="update-error">
					{{ updater.updateError }}
				</div>
				<!-- 默认提示 -->
				<div v-if="updater.status === 'idle'" class="update-hint">
					{{ I18N.update.hint }}
				</div>
				<!-- 操作按钮 -->
				<div class="update-actions">
					<!-- 检查更新 / 检查出错后重新检查 -->
					<button
						v-if="updater.status === 'idle' || updater.status === 'up-to-date' || updater.status === 'error'"
						class="update-btn"
						@click="updater.checkForUpdates"
					>
						<Icon name="refresh" :size="13"/>
						{{ updater.status === 'error' ? I18N.update.retry : I18N.update.check }}
					</button>
					<!-- 检查中 / 下载中 (禁用) -->
					<button
						v-if="updater.status === 'checking' || updater.status === 'updating'"
						class="update-btn"
						disabled
					>
						<Icon name="loading" :size="13"/>
						{{ updater.status === 'updating' ? I18N.update.updating : I18N.update.checking }}
					</button>
					<!-- 更新完成 → 重启 -->
					<button
						v-if="updater.status === 'updated'"
						class="update-btn primary"
						@click="updater.restartToApply"
					>
						{{ I18N.update.restart }}
					</button>
					<!-- 自动更新失败 → 手动更新 -->
					<button
						v-if="updater.status === 'failed'"
						class="update-btn primary"
						@click="updater.openManualUpdate"
					>
						<Icon name="arrow-right" :size="13"/>
						{{ I18N.update.manual }}
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

.version-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.6rem;
}

.version-cell {
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	padding: 0.5rem 0.7rem;
	border-radius: var(--radius-sm);
	background-color: rgba(125, 227, 255, 0.05);
	border: 0.1rem solid var(--line-subtle);
	min-width: 0;
}

.version-label {
	font-size: 0.98rem;
	color: var(--text-faint);
}

.version-value {
	font-size: 1.25rem;
	font-weight: 700;
	color: var(--text-primary);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;

	&.is-new {
		color: #4ade80;
		text-shadow: 0 0 0.8rem rgba(74, 222, 128, 0.35);
	}
}

.update-status {
	margin: -0.2rem 0 0;
}

.status-text {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	font-size: 1.05rem;
	color: var(--text-body);

	&.ok {
		color: #4ade80;
	}

	&.bad {
		color: #f472b6;
	}

	:deep(svg) {
		width: 1rem;
		height: 1rem;
	}
}

.download-percent {
	font-variant-numeric: tabular-nums;
	color: var(--deep-teal);
	font-weight: 600;
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
