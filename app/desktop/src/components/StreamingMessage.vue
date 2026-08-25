<script setup lang="ts">
import {ref, watch} from "vue"
import {createStreamingMarkdownSplitter, splitMarkdown} from "../services/text/markdownSplitter"
import MarkdownRenderer from "./MarkdownRenderer.vue"

const PROPS = defineProps<{
	text: string
	isStreaming: boolean
}>()

// 已确认分段的列表 (供 UI 逐段渲染)
const SEGMENTS = ref<string[]>([])

// 流式 Markdown 分割器: 跨增量保持代码块/结构完整
const SPLITTER = createStreamingMarkdownSplitter()

// 上一次已消费的文本长度 (用于计算本次增量)
let lastLength = 0

const render = () => {
	// 非流式 / 完成 / 静态: 用完整文本一次性重切, 保证与整段解析一致 (避免分段漂移导致渲染错误)
	if (!PROPS.isStreaming) {
		SEGMENTS.value = splitMarkdown(PROPS.text)
		return
	}
	// 流式中: 只消费新增部分, 按 md 边界切段
	if (PROPS.text.length <= lastLength) return
	const CHUNK = PROPS.text.slice(lastLength)
	lastLength = PROPS.text.length
	const {completed} = SPLITTER.consume(CHUNK)
	if (completed.length) SEGMENTS.value.push(...completed)
}

watch(() => [PROPS.text, PROPS.isStreaming], render, {immediate: true})
</script>

<template>
	<div class="streaming-message">
		<div
			v-for="(segment, index) in SEGMENTS"
			:key="index"
			class="segment"
			:class="{streaming: PROPS.isStreaming && index === SEGMENTS.length - 1}"
		>
			<MarkdownRenderer :content="segment"/>
		</div>
	</div>
</template>

<style scoped lang="less">
.streaming-message {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.segment {
	animation: segment-fade-in 0.3s ease-out;

	&.streaming {
		opacity: 0.8;
	}
}

@keyframes segment-fade-in {
	from {
		opacity: 0;
		transform: translateY(0.5rem);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}
</style>
