<script setup lang="ts">
import {computed} from "vue"
import MarkdownIt from "markdown-it"
import hljs from "highlight.js"
import {openUrl} from "@tauri-apps/plugin-opener"
import "highlight.js/styles/github-dark.css"

const PROPS = defineProps<{
	content: string
}>()

const INSTANCE = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
})

// 代码高亮, 失败回落转义纯文本
const highlightCode = (code: string, lang: string): string => {
	if (lang && hljs.getLanguage(lang)) {
		try {
			return hljs.highlight(code, {language: lang}).value
		} catch {
		}
	}
	return INSTANCE.utils.escapeHtml(code)
}

// 链接渲染: 给所有 <a> 加标记 class, 供事件委托拦截 (避免 webview 默认导航)
const DEFAULT_LINK_OPEN = INSTANCE.renderer.rules.link_open
INSTANCE.renderer.rules.link_open = (tokens, idx, options, env, self): string => {
	const DEFAULT = DEFAULT_LINK_OPEN
		? DEFAULT_LINK_OPEN(tokens, idx, options, env, self)
		: self.renderToken(tokens, idx, options)
	return DEFAULT.replace(/^<a /, "<a class=\"markdown-link\" ")
}

/**
 * 自定义代码块渲染: 语言标签 + 复制按钮 + 高亮区域
 */
INSTANCE.renderer.rules.fence = (tokens, idx, _options, _env, _self): string => {
	const CODE = tokens[idx].content
	// 清理语言标记, 防止注入 data-lang / class
	const LANG = (tokens[idx].info.trim() || "text").replace(/[^\w-]+/g, "")
	const HIGHLIGHTED = highlightCode(CODE, LANG)
	return [
		`<div class="code-block" data-lang="${LANG}">`,
		`<div class="code-header"><span class="code-lang">${LANG}</span><button type="button" class="copy-btn">复制</button></div>`,
		`<pre><code class="hljs">${HIGHLIGHTED}</code></pre>`,
		`</div>`,
	].join("")
}

const HTML_CONTENT = computed(() => INSTANCE.render(PROPS.content))

/**
 * 复制代码块 (事件委托, 兼容 v-html 生成的按钮)
 */
const copyCode = (button: HTMLButtonElement) => {
	const CODE = button.closest(".code-block")?.querySelector("code")?.textContent ?? ""
	void navigator?.clipboard?.writeText(CODE)
	const ORIGINAL = button.textContent ?? "复制"
	button.textContent = "已复制"
	setTimeout(() => {
		button.textContent = ORIGINAL
	}, 1200)
}

/**
 * 打开链接 (不默认跳转, 走系统浏览器)
 */
const openMarkdownLink = async (href: string) => {
	try {
		await openUrl(href)
	} catch (error) {
		console.error("打开链接失败:", error)
	}
}

/**
 * 根容器点击: 处理复制按钮与链接 (事件委托)
 */
const onRootClick = (event: MouseEvent) => {
	const TARGET = event.target as HTMLElement
	const COPY = TARGET.closest?.(".copy-btn") as HTMLButtonElement | null
	if (COPY) {
		copyCode(COPY)
		return
	}
	const LINK = TARGET.closest?.("a.markdown-link") as HTMLAnchorElement | null
	if (LINK) {
		event.preventDefault()
		void openMarkdownLink(LINK.href)
	}
}
</script>

<template>
	<div class="markdown-body" v-html="HTML_CONTENT" @click="onRootClick"/>
</template>

<style scoped lang="less">
.markdown-body {
	font-size: 1.3rem;
	line-height: 1.6;
	color: var(--text-body);

	:deep(p) {
		margin: 0.8rem 0;
	}

	:deep(code) {
		font-family: "Fira Code", "Cascadia Code", monospace;
		font-size: 0.9em;
	}

	:deep(.code-block) {
		margin: 1rem 0;
		border-radius: var(--radius-md);
		overflow: hidden;
		background-color: var(--surface-deep);
		border: 0.1rem solid var(--line-subtle);

		.code-header {
			padding: 0.6rem 1rem;
			display: flex;
			justify-content: space-between;
			align-items: center;
			background-color: rgba(0, 0, 0, 0.3);
			border-bottom: 0.1rem solid var(--line-subtle);

			.code-lang {
				font-size: 1.1rem;
				color: var(--deep-teal-bright);
				font-weight: 500;
			}

			.copy-btn {
				padding: 0.3rem 0.8rem;
				font-size: 1.1rem;
				border: 0.1rem solid var(--line-subtle);
				border-radius: var(--radius-sm);
				background-color: transparent;
				color: var(--text-muted);
				cursor: pointer;
				transition: all 0.2s;

				&:hover {
					background-color: var(--deep-teal);
					color: var(--ink-deep);
					border-color: var(--deep-teal-bright);
				}
			}
		}

		pre {
			padding: 1rem;
			margin: 0;
			overflow-x: auto;

			code {
				padding: 0;
				background-color: transparent;
				border-radius: 0;
			}
		}
	}

	:deep(ul), :deep(ol) {
		padding-left: 2rem;
		margin: 0.8rem 0;
	}

	:deep(blockquote) {
		padding-left: 1rem;
		margin: 1rem 0;
		border-left: 0.3rem solid var(--deep-teal);
		color: var(--text-muted);
		font-style: italic;
	}
}
</style>
