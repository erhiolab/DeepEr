<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from "vue"
import Icon from "../common/Icon.vue"
import {assetUrl} from "../../services/asset.ts"
import {useLive2DStore} from "../../services/store/live2d.ts"
import {useConversationStore} from "../../services/store/conversation.ts"
import StreamingMessage from "../StreamingMessage.vue"
import fallbackAvatar from "../../assets/images/logo.png"

const L2D = useLive2DStore()
const CONV = useConversationStore()

// 组装模型展示图 URL, 并做路径穿越校验
const modelImageUrl = (modelName: string, image: string): string | null => {
	const CLEAN = image.replace(/\\/g, "/").replace(/^\/+/, "")
	if (!CLEAN || CLEAN.startsWith("/")) return null
	const SEGMENTS = CLEAN.split("/")
	if (SEGMENTS.some(seg => seg === ".." || seg === "." || !seg)) return null
	return `${assetUrl(`live2d/${modelName}`)}/${CLEAN}`
}

// 确保已加载当前模型的配置 (名称/封面图)
const ensureConfig = async (): Promise<void> => {
	const MODEL = L2D.currentModel
	if (!MODEL) return
	if (L2D.configModelName !== MODEL) await L2D.loadConfig(MODEL)
}

// 对方显示名: 取模型配置的显示名, 空串时回落模型目录名/id
const peerName = computed<string>(() => {
	const MODEL = L2D.currentModel
	if (!MODEL) return "DeepEr"
	return (L2D.config.name || MODEL)
})

// 对方头像: 当前模型的封面图, 无图时回落占位头像
const peerAvatar = computed<string>(() => {
	const MODEL = L2D.currentModel
	if (MODEL && L2D.config.image) {
		const URL = modelImageUrl(MODEL, L2D.config.image)
		if (URL) return URL
	}
	return fallbackAvatar
})

// 输入框文本
const inputText = ref("")

// 发送消息
const sendMessage = () => {
	const TEXT = inputText.value.trim()
	if (!TEXT) return
	CONV.sendMessage(TEXT)
	inputText.value = ""
}

// 消息列表容器
const listEl = ref<HTMLElement | null>(null)

// 是否位于滚动容器底部 (用户上翻看历史时变为 false)
const atBottom = ref(true)

// 判定是否接近底部 (容差 8px, 避免边缘误差)
const isAtBottom = (): boolean => {
	const EL = listEl.value
	if (!EL) return true
	return EL.scrollHeight - EL.scrollTop - EL.clientHeight <= 8
}

// 吸底: 滚到最底部
const scrollToBottom = () => {
	atBottom.value = true
	nextTick(() => {
		const EL = listEl.value
		if (EL) EL.scrollTop = EL.scrollHeight
	})
}

// 用户滚动: 更新 atBottom. 一旦用户把滚动条翻回最底部, 恢复自动吸底
const onScroll = () => {
	atBottom.value = isAtBottom()
}

// 新消息 / 文本流式增长 / 输入状态变化时: 仅在位于底部时自动吸底
// (用户在翻阅历史时不强制滚动, 直到其滚回底部)
watch([() => CONV.history, () => CONV.isTyping], () => {
	if (atBottom.value) scrollToBottom()
}, {deep: true})

onMounted(async () => {
	const EL = listEl.value
	if (EL) EL.addEventListener("scroll", onScroll, {passive: true})
	scrollToBottom()
	await ensureConfig()
})

onUnmounted(() => {
	listEl.value?.removeEventListener("scroll", onScroll)
})

// 模型切换时重新加载配置, 及时跟上新名称/头像
watch(() => L2D.currentModel, (model) => {
	if (model) void ensureConfig()
})
</script>

<template>
	<section class="talk">
		<header class="talk-header">
			<div class="peer">
				<div class="peer-avatar-wrap">
					<img class="avatar" :src="peerAvatar" :alt="peerName"/>
					<span class="online-dot"/>
				</div>
				<div class="peer-meta">
					<h2 class="peer-name">{{ peerName }}</h2>
					<p class="peer-state" :class="{typing: CONV.isTyping}">
						{{CONV.isTyping ? "对方正在输入..." : "在线"}}
					</p>
				</div>
			</div>
			<button class="more-btn" title="更多">
				<Icon name="add" :size="18"/>
			</button>
		</header>
		<div ref="listEl" class="talk-body">
			<TransitionGroup name="msg">
				<template v-for="item in CONV.history" :key="item.id">
					<div v-if="item.side === 'center'" class="chat-time">{{ item.text }}</div>
					<div v-else class="msg-row" :class="item.side">
						<div v-if="item.side === 'left'" class="bubbles">
							<StreamingMessage
								:text="item.text"
								:is-streaming="CONV.isTyping && item.id === CONV.history[CONV.history.length - 1].id"
							/>
						</div>
						<div v-else class="bubble">{{ item.text }}</div>
					</div>
				</template>
			</TransitionGroup>
		</div>
		<footer class="talk-footer">
			<form class="input-bar" @submit.prevent="sendMessage">
				<input v-model="inputText" type="text" placeholder="输入消息…" maxlength="500"/>
				<button class="send-btn" type="submit" :disabled="!inputText.trim()">
					<Icon name="send" :size="16"/>
				</button>
			</form>
		</footer>
	</section>
</template>

<style scoped lang="less">
.talk {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background-color: var(--surface-glass);
	backdrop-filter: blur(1.2rem);
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-md);
	box-shadow: var(--shadow-soft);
}

.talk-header {
	padding: 1rem 1.4rem;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: space-between;
	background-color: rgba(8, 26, 46, 0.55);
	border-bottom: 0.1rem solid var(--line-subtle);

	.peer {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.peer-avatar-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.avatar {
		width: 3.6rem;
		height: 3.6rem;
		border-radius: 50%;
		object-fit: cover;
		border: 0.1rem solid var(--line-strong);
		animation: talk-breathe 3.2s ease-in-out infinite;
	}

	.online-dot {
		position: absolute;
		right: -0.1rem;
		bottom: 0.1rem;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		background: var(--touch-ok);
		box-shadow: 0 0 0.5rem var(--touch-ok);
		border: 0.15rem solid var(--bg-deep);
	}

	.peer-meta {
		min-width: 0;
	}

	.peer-name {
		font-size: 1.4rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: 0.03rem;
	}

	.peer-state {
		margin-top: 0.15rem;
		font-size: 1.05rem;
		color: var(--text-muted);
		transition: color 0.2s ease;

		&.typing {
			color: var(--deep-teal-bright);
		}
	}

	.more-btn {
		flex-shrink: 0;
		width: 2.8rem;
		height: 2.8rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0.1rem solid var(--line-subtle);
		border-radius: 50%;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;

		&:hover {
			background-color: rgba(125, 227, 255, 0.1);
			color: var(--deep-teal-bright);
			border-color: var(--line-strong);
		}
	}
}

.talk-body {
	flex: 1;
	padding: 1.2rem 1.4rem;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.chat-time {
	padding: 0.3rem 1rem;
	align-self: center;
	border-radius: 99.9rem;
	font-size: 1.05rem;
	color: var(--text-faint);
	background-color: rgba(125, 227, 255, 0.08);
	border: 0.1rem solid var(--line-subtle);
}

.msg-row {
	display: flex;
	align-items: flex-end;
	gap: 0.8rem;

	&.left {
		justify-content: flex-start;
		align-items: flex-start;
	}

	&.right {
		justify-content: flex-end;
	}
}

// 对方多段消息纵向排列
.bubbles {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.5rem;
	flex: 0 1 auto;
	min-width: 0;
}

.bubble {
	padding: 0.8rem 1.1rem;
	position: relative;
	width: fit-content;
	max-width: 32rem;
	border-radius: var(--radius-md);
	font-size: 1.3rem;
	line-height: 1.6;
	word-break: break-word;
	overflow-wrap: break-word;
	white-space: pre-wrap;
}

.msg-row.left .bubble {
	background-color: rgba(255, 255, 255, 0.05);
	border: 0.1rem solid var(--line-subtle);
	color: var(--text-body);
	border-top-left-radius: 0.3rem;

	&::before {
		content: "";
		position: absolute;
		left: -0.5rem;
		bottom: 0.8rem;
		border: 0.5rem solid transparent;
		border-right-color: rgba(255, 255, 255, 0.05);
		border-left: none;
	}
}

.msg-row.left :deep(.streaming-message .markdown-body) {
	padding: 0.8rem 1.1rem;
	width: fit-content;
	max-width: 32rem;
	border-radius: var(--radius-md);
	background-color: rgba(255, 255, 255, 0.05);
	border: 0.1rem solid var(--line-subtle);
	border-top-left-radius: 0.3rem;
	color: var(--text-body);
}

.msg-row.right .bubble {
	background-image: linear-gradient(135deg, var(--deep-teal-bright), var(--deep-teal));
	color: var(--ink-deep);
	font-weight: 500;
	border-top-right-radius: 0.3rem;
}

.msg-enter-active {
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.msg-enter-from {
	opacity: 0;
	transform: translateY(0.8rem) scale(0.98);
}

.msg-move {
	transition: transform 0.3s ease;
}

.talk-footer {
	flex-shrink: 0;
	padding: 1rem 1.4rem;
	background-color: rgba(8, 26, 46, 0.55);
	border-top: 0.1rem solid var(--line-subtle);
}

.input-bar {
	padding: 0.35rem 0.4rem 0.35rem 1.2rem;
	display: flex;
	align-items: center;
	gap: 0.8rem;
	background-color: var(--surface-deep);
	border: 0.1rem solid var(--line-strong);
	border-radius: 99.9rem;
	transition: border-color 0.2s ease, box-shadow 0.2s ease;

	&:focus-within {
		border-color: var(--deep-teal);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background-color: transparent;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 1.3rem;

		&::placeholder {
			color: var(--text-faint);
		}
	}
}

.send-btn {
	flex-shrink: 0;
	width: 3.2rem;
	height: 3.2rem;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: 50%;
	background-color: var(--teal-fill);
	color: var(--ink-deep);
	cursor: pointer;
	transition: all 0.2s ease;

	&:hover:not(:disabled) {
		background-color: var(--deep-teal-bright);
		box-shadow: 0 0 1rem var(--glow-teal-soft);
		transform: translateY(-0.1rem);
	}

	&:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
}

@keyframes talk-breathe {
	0%, 100% {
		box-shadow: 0 0 0 0 rgba(125, 227, 255, 0);
	}
	50% {
		box-shadow: 0 0 0 0.4rem rgba(125, 227, 255, 0.12);
	}
}
</style>
