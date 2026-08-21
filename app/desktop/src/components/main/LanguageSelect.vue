<script setup lang="ts">
import {computed, ref, onMounted} from "vue"
import useLanguage from "../../services/i18n"
import useLanguages from "../../services/i18n/useLanguages.ts"
import type {LanguageType} from "../../services/i18n"
import {toast} from "vue3-toastify"
import zhCn from "../../assets/images/flags/cn.png"
import enGb from "../../assets/images/flags/gb.png"
import enUs from "../../assets/images/flags/us.png"
import Icon from "../common/Icon.vue"
import {logger} from "../../services/logger"

const language = useLanguage

const I18N = computed(() => useLanguages().components.main.languageSelect)

// 语言 code → 本地国旗图片 (来自 flagcdn 下载, 存于 src/assets/images/flags)
const FLAG_MAP: Record<string, string> = {
	"zh-CN": zhCn,
	"zh": zhCn,
	"en": enGb,
	"en-US": enUs
}

// 语言 code → 显示名称 (fallback 用 Intl.DisplayNames)
const NAME_MAP: Record<string, string> = {
	"zh-CN": "简体中文",
	"zh": "简体中文",
	"en": "English",
	"en-US": "English (US)",
}

// 获取语言国旗图片 (fallback 用 code 本身)
const flagOf = (code: string): string => FLAG_MAP[code] ?? FLAG_MAP[code.split("-")[0]] ?? ""

// 获取语言显示名称 (fallback 用 code 本身)
const nameOf = (code: string): string => NAME_MAP[code] ?? new Intl.DisplayNames([code], {type: "language"}).of(code.split("-")[0]) ?? code

// 可用语言列表
const languages = ref<string[]>([])

// 当前语言
const current = ref<LanguageType>("zh-CN")

// 加载语言列表和当前语言
onMounted(async () => {
	try {
		languages.value = await language.getLanguages()
		current.value = await language.getLanguage()
	} catch (error) {
		logger.error("加载语言列表失败:", error)
		toast.error(I18N.value.loadLanguagesFailed)
	}
})

// 切换语言
const select = async (code: string) => {
	if (code === current.value) return
	current.value = code
	try {
		await language.setLanguage(code)
	} catch (error) {
		logger.error("切换语言失败:", error)
		toast.error(I18N.value.switchLanguageFailed)
	}
}
</script>

<template>
	<section key="language-select" class="page-lang">
		<div class="lang-head">
			<h2 class="lang-title">{{ I18N.title }}</h2>
			<p class="lang-sub">{{ I18N.subtitle }}</p>
		</div>

		<div class="lang-current">
			<span class="lang-current-label">{{ I18N.current }}</span>
			<span class="lang-current-value">
				<img v-if="flagOf(current)" class="lang-flag" :src="flagOf(current)" :alt="nameOf(current)"/>
				<span v-else class="lang-flag lang-flag-empty"></span>
				{{ nameOf(current) }}
			</span>
		</div>

		<div class="lang-list">
			<button
				v-for="code in languages"
				:key="code"
				class="lang-item"
				:class="{active: current === code}"
				@click="select(code)"
			>
				<img v-if="flagOf(code)" class="lang-flag" :src="flagOf(code)" :alt="nameOf(code)"/>
				<span v-else class="lang-flag lang-flag-empty"></span>
				<span class="lang-name">{{ nameOf(code) }}</span>
				<span class="lang-code">{{ code }}</span>
				<span class="lang-check"><Icon name="check"/></span>
			</button>
			<p v-if="languages.length === 0" class="lang-empty">{{ I18N.langEmpty }}</p>
		</div>
	</section>
</template>

<style scoped lang="less">
.page-lang {
	width: 100%;
	max-width: 44rem;
	margin: 0 auto;
	height: 100%;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 1.6rem;
}

.lang-head {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.4rem;
	text-align: center;

	.lang-title {
		font-size: 2rem;
		font-weight: 600;
		color: var(--text-primary);
		text-shadow: 0 0 1.8rem var(--glow-teal), 0 0 6rem var(--glow-teal-soft);
	}

	.lang-sub {
		font-size: 1.2rem;
		color: var(--text-muted);
	}
}

.lang-current {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	padding: 1rem 1.6rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);

	.lang-current-label {
		font-size: 1.2rem;
		color: var(--text-muted);
	}

	.lang-current-value {
		display: inline-flex;
		align-items: center;
		gap: 0.8rem;
		font-size: 1.3rem;
		color: var(--deep-teal-bright);
	}
}

.lang-list {
	width: 100%;
	max-height: 24rem;
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	overflow-y: auto;
	padding: 0.2rem 0.2rem;
}

.lang-item {
	padding: 1rem 1.4rem;
	display: flex;
	align-items: center;
	gap: 1.2rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-primary);
	font-size: 1.4rem;
	font-family: inherit;
	cursor: pointer;
	text-align: left;
	transition: all 0.2s ease;

	&:hover {
		background-color: rgba(125, 227, 255, 0.08);
		border-color: var(--deep-teal-soft);
	}

	&.active {
		border-color: var(--deep-teal);
		background-color: rgba(125, 227, 255, 0.12);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
	}
}

.lang-flag {
	width: 3rem;
	height: 2rem;
	object-fit: cover;
	border-radius: 0.25rem;
	flex-shrink: 0;
	box-shadow: 0 0 0.4rem rgba(0, 0, 0, 0.3);

	&.lang-flag-empty {
		background-color: rgba(255, 255, 255, 0.1);
	}
}

.lang-name {
	flex: 1;
}

.lang-code {
	font-size: 1.1rem;
	color: var(--text-muted);
	letter-spacing: 0.04rem;
}

.lang-check {
	color: var(--deep-teal);
	display: inline-flex;
	align-items: center;
	opacity: 0;
	transition: opacity 0.2s ease;

	:deep(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}

	.active & {
		opacity: 1;
	}
}

.lang-empty {
	font-size: 1.3rem;
	color: var(--text-faint);
	text-align: center;
}
</style>
