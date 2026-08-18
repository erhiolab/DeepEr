<script setup lang="ts">
import {computed} from "vue"
import {openUrl} from "@tauri-apps/plugin-opener"
import useLanguages from "../../services/i18n/useLanguages.ts"
import Icon from "../Icon.vue"
import logo from "../../assets/images/logo.png"
import erhiolab from "../../assets/images/erhio.webp"
import QiCaiJie114514 from "../../assets/images/QiCaiJie114514.webp"
import whiteNight from "../../assets/images/whiteNight.webp"
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
		name: "白夜",
		role: "I_NORI 开发者",
		avatar: whiteNight
	},
	{
		name: "Nori",
		role: "吉祥物",
		avatar: inori
	},
	{
		name: "I_NORI 交流群",
		role: "反馈 · 建议",
		avatar: inori
	}
]

// 打开外部链接
const openLink = async (url: string) => {
	try {
		await openUrl(url)
	} catch (error) {
		console.error("打开链接失败:", error)
	}
}
</script>

<template>
	<section key="about" class="page page-about">
		<div class="about-head">
			<img class="about-logo" :src="logo" alt="Nori"/>
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
			<h3 class="block-title">{{ I18N.linksTitle }}</h3>
			<div class="links">
				<button class="link-card" @click="openLink('https://github.com/erhiolab/Nori-Desktop-Pet')">
					<span class="link-text">
						<span class="link-label">{{ I18N.source.label }}</span>
						<span class="link-sub">{{ I18N.source.sub }}</span>
					</span>
					<span class="link-arrow">
						<Icon name="arrow-right"/>
					</span>
				</button>
				<button class="link-card" @click="openLink('https://github.com/erhiolab/Nori-Desktop-Pet/issues')">
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
			border-color: var(--nori-teal-soft);
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
	color: var(--nori-teal);
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
	color: var(--nori-teal);
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
		border-color: var(--nori-teal-soft);
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
	color: var(--nori-teal);
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;

	:deep(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
}
</style>
