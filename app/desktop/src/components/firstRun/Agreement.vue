<script setup lang="ts">
import {computed} from "vue"
import useLanguages from "../../services/i18n/useLanguages.ts"

const I18N = computed(() => useLanguages().components.firstRun.agreement)

// 协议分组
const GROUPS = [
	{
		title: "📜 开源许可",
		intro: "本项目源代码采用 GPL-3.0 协议授权。",
		items: [
			"你可以自由使用、复制、修改与分发本项目源代码。",
			"基于本项目源码的任何衍生作品, 同样需要以 GPL-3.0 协议开源发布。",
			"GPL-3.0 仅适用于本项目作者编写并明确标记的部分, 不授予对第三方组件的任何额外权利。"
		]
	},
	{
		title: "🔒 Live2D SDK 声明",
		intro: "本项目使用的 Live2D Cubism SDK 不属于 GPL-3.0 授权范围。",
		items: [
			"Live2D Cubism SDK 及其组件/运行库由 Live2D Inc. 以独立许可协议授权 (本项目为非商业授权)。",
			"使用 / 复制 / 修改 / 分发 Live2D SDK 时, 应遵守 Live2D 官方许可协议。",
			"因此本软件不可用于商业用途, 如需商用请向 Live2D 官方另行申请商业授权。",
			"配套的 Live2D 模型资源同时受其原作者授权约束, 请尊重每一位创作者。"
		]
	}
]
</script>

<template>
	<section key="agreement" class="page page-agreement">
		<div class="agree-head">
			<h2 class="agree-title glow-teal">{{ I18N.title }}</h2>
			<p class="agree-subtitle">{{ I18N.subtitle }}</p>
		</div>
		<div class="agree-body">
			<div v-for="group in GROUPS" :key="group.title" class="agree-group">
				<h3 class="group-title">{{ group.title }}</h3>
				<p class="group-intro">{{ group.intro }}</p>
				<ul class="group-items">
					<li v-for="item in group.items" :key="item" class="group-item">
						<span class="dot"/>
						<span class="item-text">{{ item }}</span>
					</li>
				</ul>
			</div>
		</div>
		<div class="agree-foot">
			<span class="agree-note">{{ I18N.agree }}</span>
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

.page-agreement {
	padding: 1.4rem 5.6rem 1.6rem;
	gap: 1.3rem;
	overflow: hidden;
}

.agree-head {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	flex-shrink: 0;
}

.agree-title {
	font-size: 2.4rem;
	font-weight: 700;
	color: var(--text-primary);
	line-height: 1.2;
}

.agree-subtitle {
	font-size: 1.2rem;
	color: var(--text-faint);
}

.agree-body {
	flex: 1;
	padding-right: 0.4rem;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 1.2rem;
}

.agree-group {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	padding: 1.1rem 1.4rem;
	border-radius: var(--radius-sm);
	background: rgba(125, 227, 255, 0.04);
	border: 0.1rem solid var(--line-subtle);
}

.group-title {
	font-size: 1.35rem;
	font-weight: 600;
	color: var(--deep-teal);
}

.group-intro {
	font-size: 1.1rem;
	line-height: 1.6;
	color: var(--text-muted);
	font-weight: 500;
}

.group-items {
	padding: 0;
	margin: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.group-item {
	display: flex;
	align-items: flex-start;
	gap: 0.7rem;
	font-size: 1.13rem;
	line-height: 1.65;
	color: var(--text-body);
}

.dot {
	flex-shrink: 0;
	margin-top: 0.55rem;
	width: 0.45rem;
	height: 0.45rem;
	border-radius: 50%;
	background-color: var(--deep-teal);
}

.agree-foot {
	padding-top: 0.4rem;
	flex-shrink: 0;
	display: flex;
	justify-content: center;
}

.agree-note {
	padding: 0.6rem 1.6rem;
	font-size: 1.15rem;
	color: var(--text-muted);
	border-radius: 99.9rem;
	background-color: rgba(125, 227, 255, 0.05);
	border: 0.1rem solid var(--line-subtle);
}
</style>
