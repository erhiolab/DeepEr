<script setup lang="ts">
import {ref, watch} from "vue"
import {splitMarkdown} from "../services/text/markdownSplitter"
import MarkdownRenderer from "./MarkdownRenderer.vue"

const PROPS = defineProps<{
	text: string
	isStreaming: boolean
}>()

// 已确认分段的列表 (供 UI 逐段渲染)
const SEGMENTS = ref<string[]>([])

// 每次 text 变化都用完整文本整体重分段, 并立即渲染.
// 不做增量割分/留尾巴 (那会导致气泡滞后于 store 的逐段推进, 已证明会"配音后才出气泡").
const render = () => {
	SEGMENTS.value = splitMarkdown(PROPS.text)
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
