<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue"
import useLanguages from "../../services/i18n/useLanguages"
import Icon from "../common/Icon.vue"
import SectionCard from "../common/SectionCard.vue"
import EmptyState from "../common/EmptyState.vue"
import {getHomeStats, type HomeStats} from "../../services/stats"
import {contextList, type ContextRecord} from "../../services/context"
import {getOfficialCovers, localModelCover} from "../../services/live2dCover"
import {useLive2DStore} from "../../services/store/live2d"
import type {IconName} from "../../services/icon"
import logoFallback from "../../assets/images/logo.png"

const I18N = computed(() => useLanguages().components.main.home)
const L2D = useLive2DStore()

// 主界面统计
const stats = ref<HomeStats | null>(null)

// 最近对话
const recent = ref<ContextRecord[]>([])

// 模型图片 (与模型选择页一致: 自定义用本地配置封面, 官方用官方列表 coverUrl)
const avatarBroken = ref(false)

// 官方模型封面 (远程 coverUrl, 带缓存, 与模型选择页共用)
const officialCovers = ref<Record<string, string>>({})

// 时钟 (每秒刷新)
const nowTick = ref(Date.now())

// 时钟 (每秒刷新)
let clockTimer: ReturnType<typeof setInterval> | null = null

// 统计 (每 5 秒刷新)
let statsTimer: ReturnType<typeof setInterval> | null = null

// 时钟格式化
const pad2 = (n: number): string => String(n).padStart(2, "0")

// 时钟文本
const clockText = computed(() => {
	const D = new Date(nowTick.value)
	return `${D.getFullYear()} ${I18N.value.year} ${pad2(D.getMonth() + 1)} ${I18N.value.month} ${pad2(D.getDate())} ${I18N.value.day} ${pad2(D.getHours())}:${pad2(D.getMinutes())}:${pad2(D.getSeconds())}`
})

// 欢迎语
const greeting = computed(() => {
	const HOUR = new Date(nowTick.value).getHours()
	if (HOUR < 6) return I18N.value.goodNight
	if (HOUR < 12) return I18N.value.goodMorning
	if (HOUR < 18) return I18N.value.goodAfternoon
	return I18N.value.goodEvening
})

// 当前模型图片 (与模型选择页一致: 自定义用本地配置封面, 官方用官方列表 coverUrl)
const modelAvatar = computed(() => {
	const MODEL = L2D.currentModel
	if (!MODEL || avatarBroken.value) return null
	const LOCAL = localModelCover(MODEL, L2D.config.image)
	if (LOCAL) return LOCAL
	return officialCovers.value[MODEL] ?? null
})

// 官方模型封面 (远程 coverUrl, 带缓存, 与模型选择页共用)
const loadOfficialCovers = async (): Promise<void> => {
	officialCovers.value = await getOfficialCovers()
}

// 数字格式化
const fmt = (n: number): string => n.toLocaleString("zh-CN")

// 数字格式化 (压缩)
const fmtCompact = (n: number): string => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

// 平均命中率
const hitRate = computed(() => {
	if (stats.value?.avgHitRate == null) return null
	return Math.round(stats.value.avgHitRate * 100)
})

// 顶部统计卡片
const statCards = computed<{ icon: IconName, label: string, value: string, tone: string }[]>(() => [
	{icon: "send", label: I18N.value.statMessages, value: fmt(stats.value?.totalMessages ?? 0), tone: "teal"},
	{icon: "page", label: I18N.value.statToday, value: fmt(stats.value?.todayMessages ?? 0), tone: "blue"},
	{
		icon: "database",
		label: I18N.value.statTokens,
		value: fmtCompact((stats.value?.totalInputTokens ?? 0) + (stats.value?.totalOutputTokens ?? 0)),
		tone: "purple",
	},
	{
		icon: "tasks",
		label: I18N.value.statHitRate,
		value: hitRate.value == null ? "_" : `${hitRate.value}%`,
		tone: "green"
	},
])

// 数据概览明细
const overviewItems = computed(() => [
	{label: I18N.value.inputTokens, value: fmtCompact(stats.value?.totalInputTokens ?? 0)},
	{label: I18N.value.outputTokens, value: fmtCompact(stats.value?.totalOutputTokens ?? 0)},
	{label: I18N.value.memories, value: fmt(stats.value?.memoryCount ?? 0)},
	{label: I18N.value.tools, value: fmt(stats.value?.toolCount ?? 0)},
	{label: I18N.value.scheduledTasks, value: fmt(stats.value?.enabledTaskCount ?? 0)},
	{label: I18N.value.nextTask, value: stats.value?.nextTaskTitle ?? I18N.value.nextTaskNone},
])

// 近 7 天 Token 消耗柱状图
const maxDaily = computed(() => Math.max(1, ...(stats.value?.dailyActivity.map(item => item.tokens) ?? [0])))

// 近 7 天 Token 消耗柱状图高度
const barHeight = (tokens: number): string => `${Math.max(4, Math.round((tokens / maxDaily.value) * 100))}%`

// 最近消息时间 (今天=时分, 更早=月-日 时分)
const fmtRecentTime = (timestamp: number): string => {
	const D = new Date(timestamp * 1000)
	const NOW = new Date()
	const TIME = `${pad2(D.getHours())}:${pad2(D.getMinutes())}`
	const SAME_DAY = D.getFullYear() === NOW.getFullYear() && D.getMonth() === NOW.getMonth() && D.getDate() === NOW.getDate()
	return SAME_DAY ? TIME : `${pad2(D.getMonth() + 1)}-${pad2(D.getDate())} ${TIME}`
}

// 加载
const load = async (): Promise<void> => {
	stats.value = await getHomeStats()
	recent.value = (await contextList(8, 0))
		.filter(record => record.type === "talk" && record.role && record.content.trim())
		.slice(0, 6)
}

onMounted(() => {
	void (async () => {
		const MODEL = L2D.currentModel
		if (MODEL && L2D.configModelName !== MODEL) await L2D.loadConfig(MODEL)
		await loadOfficialCovers()
		await load()
	})()
	clockTimer = setInterval(() => {
		nowTick.value = Date.now()
	}, 1000)
	statsTimer = setInterval(() => {
		void load()
	}, 60_000)
})

onBeforeUnmount(() => {
	if (clockTimer) clearInterval(clockTimer)
	if (statsTimer) clearInterval(statsTimer)
})
</script>

<template>
	<section class="page-home">
		<header class="home-hero">
			<div class="hero-copy">
				<h2 class="hero-title">{{ greeting }}</h2>
				<p class="hero-clock">{{ clockText }}</p>
			</div>
			<div class="hero-avatar-wrap">
				<img v-if="modelAvatar" :src="modelAvatar" alt="model" @error="avatarBroken = true"/>
				<img v-else :src="logoFallback" alt="DeepEr"/>
			</div>
		</header>

		<div class="stat-grid">
			<div v-for="card in statCards" :key="card.label" class="stat-card" :class="card.tone">
				<Icon :name="card.icon" :size="18" class="stat-icon"/>
				<span class="stat-value">{{ card.value }}</span>
				<span class="stat-label">{{ card.label }}</span>
			</div>
		</div>

		<div class="home-grid">
			<SectionCard :title="I18N.activity" icon="page" :subtitle="I18N.activityHint">
				<div class="chart">
					<div
						v-for="item in stats?.dailyActivity ?? []"
						:key="item.day"
						class="chart-col"
						:title="`${item.day} ${I18N.chartTooltip(item.tokens, item.messages)}`"
					>
						<span class="chart-value">{{ item.tokens ? fmtCompact(item.tokens) : "" }}</span>
						<div class="chart-bar-wrap">
							<div class="chart-bar" :style="{height: barHeight(item.tokens)}"/>
						</div>
						<span class="chart-label">{{ item.day.slice(5) }}</span>
					</div>
				</div>
			</SectionCard>

			<SectionCard :title="I18N.overview" icon="database">
				<div class="overview-grid">
					<div v-for="item in overviewItems" :key="item.label" class="overview-item">
						<span class="overview-value" :title="item.value">{{ item.value }}</span>
						<span class="overview-label">{{ item.label }}</span>
					</div>
				</div>
			</SectionCard>
		</div>

		<SectionCard :title="I18N.recent" icon="send">
			<EmptyState
				v-if="recent.length === 0"
				icon="send"
				:hint="I18N.recentEmpty"
			/>
			<div v-else class="recent-list">
				<div v-for="message in recent" :key="message.id" class="recent-row">
					<span class="recent-time">{{ fmtRecentTime(message.createdAt) }}</span>
					<span class="recent-role" :class="message.role">
						{{ message.role === "assistant" ? I18N.assistant : I18N.user }}
					</span>
					<span class="recent-text">{{ message.content }}</span>
				</div>
			</div>
		</SectionCard>
	</section>
</template>

<style scoped lang="less">
.page-home {
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	overflow-y: auto;
	padding-right: 0.2rem;
}

.home-hero {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 1.2rem 1.4rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-image: linear-gradient(135deg, rgba(125, 227, 255, 0.1), rgba(8, 26, 46, 0.2) 55%);
	box-shadow: var(--shadow-soft);

	.hero-copy {
		min-width: 0;

		.hero-title {
			margin: 0;
			font-size: 1.8rem;
			font-weight: 700;
			color: var(--text-primary);
			text-shadow: var(--glow-text);
		}

		.hero-clock {
			margin: 0.4rem 0 0;
			font-size: 1.15rem;
			color: var(--text-muted);
			font-variant-numeric: tabular-nums;
			letter-spacing: 0.04rem;
		}
	}

	.hero-avatar-wrap {
		width: 4.6rem;
		height: 4.6rem;
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		border: 0.2rem solid rgba(125, 227, 255, 0.45);
		box-shadow: 0 0 1.8rem var(--glow-teal), 0 0 3rem var(--glow-teal-soft);

		img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}
	}
}

.stat-grid {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 1rem;
}

.stat-card {
	padding: 1rem 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.02);
	position: relative;
	overflow: hidden;
	transition: all 0.2s ease;

	&:hover {
		border-color: var(--line-strong);
		transform: translateY(-0.15rem);
	}

	.stat-icon {
		width: 2.6rem;
		height: 2.6rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		background-color: rgba(125, 227, 255, 0.1);
	}

	.stat-value {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 1.05rem;
		color: var(--text-muted);
	}

	&.teal {
		.stat-icon {
			color: var(--deep-teal-bright);
		}
	}

	&.blue {
		.stat-icon {
			color: var(--touch-tap);
		}
	}

	&.purple {
		.stat-icon {
			color: var(--touch-frenzy);
		}
	}

	&.green {
		.stat-icon {
			color: var(--touch-ok);
		}
	}
}

.home-grid {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem;
}

.chart {
	height: 10rem;
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 0.8rem;
	padding-top: 0.6rem;

	.chart-col {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;

		.chart-value {
			font-size: 0.95rem;
			color: var(--text-faint);
			font-variant-numeric: tabular-nums;
		}

		.chart-bar-wrap {
			width: 100%;
			flex: 1;
			min-height: 0;
			display: flex;
			align-items: flex-end;
			justify-content: center;

			.chart-bar {
				width: 55%;
				max-width: 2rem;
				border-radius: 0.4rem 0.4rem 0 0;
				background-image: linear-gradient(180deg, var(--deep-teal-bright), var(--deep-teal));
				box-shadow: 0 0 0.8rem var(--glow-teal-soft);
				transition: height 0.3s ease;
			}
		}

		.chart-label {
			font-size: 0.95rem;
			color: var(--text-muted);
			font-variant-numeric: tabular-nums;
		}
	}
}

.overview-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.8rem;

	.overview-item {
		padding: 0.8rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border: 0.1rem solid var(--line-subtle);
		border-radius: var(--radius-sm);
		background-color: rgba(125, 227, 255, 0.04);

		.overview-value {
			font-size: 1.35rem;
			font-weight: 700;
			color: var(--deep-teal-bright);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-variant-numeric: tabular-nums;
		}

		.overview-label {
			font-size: 1rem;
			color: var(--text-muted);
		}
	}
}

.recent-list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;

	.recent-row {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
		padding: 0.55rem 0.8rem;
		border-radius: var(--radius-sm);
		background-color: rgba(255, 255, 255, 0.02);
		transition: background-color 0.2s ease;

		&:hover {
			background-color: rgba(125, 227, 255, 0.05);
		}

		.recent-time {
			flex-shrink: 0;
			font-size: 1rem;
			color: var(--text-faint);
			font-variant-numeric: tabular-nums;
		}

		.recent-role {
			flex-shrink: 0;
			padding: 0.05rem 0.6rem;
			border-radius: 99.9rem;
			font-size: 0.95rem;
			font-weight: 600;

			&.assistant {
				color: var(--deep-teal-bright);
				background-color: rgba(125, 227, 255, 0.1);
			}

			&.user {
				color: var(--touch-ok);
				background-color: rgba(127, 224, 160, 0.1);
			}
		}

		.recent-text {
			flex: 1;
			min-width: 0;
			font-size: 1.1rem;
			color: var(--text-body);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
}
</style>
