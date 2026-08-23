<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue"
import Icon from "../common/Icon.vue"
import {assetUrl} from "../../services/asset.ts"
import {useLive2DStore} from "../../services/store/live2d.ts"
import fallbackAvatar from "../../assets/images/logo.png"

const L2D = useLive2DStore()

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

// kind: time = 居中时间分隔, tip = 居中系统状态, msg = 普通消息
type ChatItem =
	| {id: number; kind: "time"; text: string}
	| {id: number; kind: "tip"; text: string}
	| {id: number; kind: "msg"; role: "other" | "self"; text: string}

// 消息 id
let nextId = 0

// 消息自增 id
const makeId = () => ++nextId

// 会话消息列表
const items = ref<ChatItem[]>([
	{id: makeId(), kind: "time", text: "11月4日 下午 5:14"},
	{id: makeId(), kind: "msg", role: "other", text: "嗨~ 我是薇塔~"},
	{id: makeId(), kind: "msg", role: "other", text: "我在我在~"},
	{id: makeId(), kind: "tip", text: "DeepEr 戳了戳 我"},
	{id: makeId(), kind: "msg", role: "other", text: "(笑)"},
	{id: makeId(), kind: "msg", role: "self", text: "不错"},
])

// 输入框文本
const inputText = ref("")

// 对方是否正在输入/加载
const typing = ref(false)

// 发送消息: 追加自己的消息并进入"正在输入中"状态
const sendMessage = () => {
	const TEXT = inputText.value.trim()
	if (!TEXT) return
	items.value.push({id: makeId(), kind: "msg", role: "self", text: TEXT})
	inputText.value = ""
	typing.value = true
}

// 消息列表容器
const listEl = ref<HTMLElement | null>(null)

// 滚动到底部
const scrollToBottom = () => {
	nextTick(() => {
		const EL = listEl.value
		if (EL) EL.scrollTop = EL.scrollHeight
	})
}

// 新消息 / 输入状态变化时滚动到底部
watch([() => items.value.length, typing], scrollToBottom)

onMounted(async () => {
	scrollToBottom()
	await ensureConfig()
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
					<p class="peer-state" :class="{typing}">{{ typing ? "对方正在输入..." : "在线" }}</p>
				</div>
			</div>
			<button class="more-btn" title="更多">
				<Icon name="add" :size="18"/>
			</button>
		</header>
		<div ref="listEl" class="talk-body">
			<TransitionGroup name="msg">
				<template v-for="item in items" :key="item.id">
					<div v-if="item.kind === 'time'" class="chat-time">{{ item.text }}</div>
					<div v-else-if="item.kind === 'tip'" class="chat-tip">{{ item.text }}</div>
					<div v-else class="msg-row" :class="item.role">
						<img v-if="item.role === 'other'" class="avatar" :src="peerAvatar" :alt="peerName"/>
						<div class="bubble">{{ item.text }}</div>
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

.chat-tip {
	padding: 0.3rem 1rem;
	align-self: center;
	border-radius: 99.9rem;
	font-size: 1.05rem;
	color: var(--text-muted);
	background-color: rgba(125, 227, 255, 0.06);
	border: 0.1rem solid var(--line-subtle);
}

.msg-row {
	display: flex;
	align-items: flex-end;
	gap: 0.8rem;

	&.other {
		justify-content: flex-start;
	}

	&.self {
		justify-content: flex-end;
	}

	.avatar {
		width: 3.2rem;
		height: 3.2rem;
		flex-shrink: 0;
		border-radius: 50%;
		object-fit: cover;
		border: 0.1rem solid var(--line-strong);
	}

	&.other .avatar {
		animation: talk-breathe 3.2s ease-in-out infinite;
	}
}

.bubble {
	padding: 0.8rem 1.1rem;
	position: relative;
	max-width: 32rem;
	border-radius: var(--radius-md);
	font-size: 1.3rem;
	line-height: 1.6;
	word-break: break-word;
	overflow-wrap: break-word;
	white-space: pre-wrap;
}

.msg-row.other .bubble {
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

.msg-row.self .bubble {
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
