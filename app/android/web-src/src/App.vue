<template>
	<div
		class="stage-root"
		@touchstart.passive="onTouchStart"
		@touchmove.passive="onTouchMove"
		@touchend.passive="onTouchEnd"
		@touchcancel.passive="onTouchEnd"
	>
		<!-- 涟漪层 -->
		<div ref="rippleHost" class="ripple-host"></div>

		<div class="topbar">
			<div class="tag" @click="panel = panel === 'model' ? '' : 'model'">{{ currentModel?.name ?? "—" }}</div>
			<div v-if="error" class="err" @click="error = ''">{{ error }} ✕</div>
			<div v-else-if="loading" class="loading">{{ loadingMsg }}</div>
		</div>

		<!-- 对话面板: 悬浮在按钮群上方 -->
		<transition name="chat">
			<div v-if="chatOpen" class="chat-panel">
				<div class="chat-head">
					<span class="chat-title">对话 · {{ curModelName }}</span>
					<button class="x" @click="chatOpen = false">✕</button>
				</div>
				<div ref="chatScroll" class="chat-msgs" :style="{ fontSize: chatFontPX }">
					<div v-if="!messages.length" class="chat-empty">和我说点什么吧</div>
					<div
						v-for="(m, i) in messages"
						:key="i"
						class="bubble-wrap"
						:class="m.role"
					>
						<div class="bubble">{{ m.content }}</div>
					</div>
					<div v-if="typing" class="bubble-wrap assistant"><div class="bubble typing">…</div></div>
				</div>
				<div class="chat-input">
					<input
						v-model="draft"
						:placeholder="modelReady ? '输入消息…' : '请先在设置里配置 API Key 和模型'"
						@keydown.enter="send"
						:disabled="typing"
					/>
					<button class="send" @click="send" :disabled="typing || !draft.trim()">发送</button>
				</div>
			</div>
		</transition>

		<div class="dock">
			<button class="fab ripple" @click="playRand" :disabled="!ready">动作</button>
			<button class="fab ripple primary" @click="playExpr" :disabled="!ready">表情</button>
			<button class="fab ripple" @click="openPanel('model')">模型</button>
			<button class="fab ripple" @click="openPanel('settings')">设置</button>
			<button class="fab ripple" @click="toggleChat">对话</button>
		</div>

		<transition name="sheet">
			<div v-if="panel" class="sheet-mask" @click.self="panel = ''">
				<div class="sheet">
					<div class="sheet-head">
						<span class="sheet-title">{{ panelTitle(panel) }}</span>
						<button class="x" @click="panel = ''">✕</button>
					</div>
					<div class="sheet-body">
						<!-- 模型选择 -->
						<template v-if="panel === 'model'">
							<div v-if="listError" class="empty">{{ listError }}</div>
							<div v-else-if="!modelList.length" class="empty">正在获取模型列表…</div>
							<div v-else class="grid">
								<div v-for="m in modelList" :key="m.id" class="mc" :class="{on: m.id === currentModelId}" @click="pick(m.id)">
									<div class="thumb"><img :src="coverUrl(m.id)" @error="hideThumb" /></div>
									<div class="mname">{{ m.name }}</div>
								</div>
							</div>
						</template>

						<!-- 动作 -->
						<template v-else-if="panel === 'motion'">
							<div v-if="!motions.length" class="empty">暂无动作</div>
							<div v-for="g in motions" :key="g.group" class="grp">
								<div class="grp-name">{{ g.group }}</div>
								<div class="chips">
									<button v-for="(n, i) in g.names" :key="n" class="chip ripple" @click="doMotion(g.group, i)">{{ n }}</button>
								</div>
							</div>
						</template>

						<!-- 表情 -->
						<template v-else-if="panel === 'expression'">
							<div v-if="!expressions.length" class="empty">暂无表情</div>
							<div class="chips">
								<button class="chip w ripple" @click="l2d.stopExpression()">清除</button>
								<button v-for="n in expressions" :key="n" class="chip ripple" @click="l2d.playExpression(n)">{{ n }}</button>
							</div>
						</template>

						<!-- 设置 -->
						<template v-else-if="panel === 'settings'">
							<div class="settings-row">
								<label>API Base URL</label>
								<input v-model="cfg.baseUrl" type="text" spellcheck="false" autocomplete="off" />
							</div>
							<div class="settings-row">
								<label>API Key</label>
								<input v-model="cfg.apiKey" type="password" autocomplete="off" />
							</div>
							<div class="settings-row">
								<label>模型</label>
								<div class="model-pick">
									<select v-model="cfg.model">
										<option value="" disabled>— 选择模型 —</option>
										<option v-for="md in modelOptions" :key="md" :value="md">{{ md }}</option>
									</select>
									<button class="mini ripple" @click="refreshModels">加载模型</button>
								</div>
								<div v-if="modelLoadMsg" class="hint">{{ modelLoadMsg }}</div>
							</div>
							<div class="settings-row">
								<label>气泡大小 {{ bubbleScaleNum.toFixed(2) }}</label>
								<input type="range" min="0.7" max="1.8" step="0.05" v-model.number="cfg.bubbleScale" />
							</div>
							<div class="settings-row">
								<label>聊天记录存储</label>
								<div class="model-pick">
									<span class="hint" :class="{ok: storageReady, bad: !storageReady}">
										{{ storageReady ? "已写入公共存储（卸载也不丢）" : "未授权，记录只在本机临时保存" }}
									</span>
									<button v-if="!storageReady" class="mini ripple" @click="grantStorage">去授权</button>
								</div>
							</div>
							<button class="btn ripple" @click="saveSettingsNow">保存设置</button>
						</template>
					</div>
				</div>
			</div>
		</transition>
	</div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, reactive, ref} from "vue"
import {
	createLive2D,
	readModelConfig,
	writeModelConfig,
	type MotionGroup,
} from "./services/live2d"
import {applyCanvasLayout} from "./services/live2d/stage"
import {readMotionGroups, readExpressionNames} from "./services/live2d/motions"
import {coverUrl} from "./services/gateway/api"
import {fetchModelList, ensureModel, listInstalled} from "./services/live2d/modelStore"
import {
	loadSettings,
	saveSettings,
	loadChat,
	persistChat,
	fetchModels,
	sendChat,
	readMemory,
	appendMemory,
	isStorageReady,
	requestStoragePermission,
	PERSONA_PROMPT,
	type ChatMsg,
} from "./services/chat"

type P = "model" | "motion" | "expression" | "settings" | ""

const l2d = createLive2D()
const loading = ref(false)
const error = ref("")
const ready = ref(false)
const panel = ref<P>("")
const currentModelId = ref<string>("")
const motions = ref<MotionGroup[]>([])
const expressions = ref<string[]>([])
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const loadingMsg = ref("加载中…")
const modelList = ref<{id: string; name: string}[]>([])
const listError = ref("")

const currentModel = computed(() => modelList.value.find((m) => m.id === currentModelId.value))
const panelTitle = (p: P) => ({model: "选择模型", motion: "动作列表", expression: "表情列表", settings: "设置"} as Record<string, string>)[p] ?? ""

const hideThumb = (e: Event) => { (e.currentTarget as HTMLElement).style.visibility = "hidden" }

/* ================= 模型展示与布局 ================= */

const relayout = () =>
	applyCanvasLayout(l2d.canvas(), undefined, {
		zIndex: "1", scale: scale.value, offsetX: offsetX.value, offsetY: offsetY.value, animate: false,
	})

const loadModel = async () => {
	const id = currentModelId.value
	const model = modelList.value.find((m) => m.id === id)
	if (!model) return
	loading.value = true; error.value = ""; ready.value = false
	motions.value = []; expressions.value = []
	try {
		loadingMsg.value = `下载 ${model.name}…`
		const entryBase = await ensureModel(id, model.name, () => {})
		loadingMsg.value = "加载中…"
		await l2d.destroy()
		await l2d.mount({directory: id, fileBase: entryBase}, {canvasWidth: "100%", canvasHeight: "100%"})
		scale.value = (await readModelConfig(id, "l2d_scale", (v) => (typeof v === "number" ? v : parseFloat(String(v))), 1)) || 1
		offsetX.value = (await readModelConfig(id, "l2d_offset_x", (v) => (typeof v === "number" ? v : parseFloat(String(v))), 0)) || 0
		offsetY.value = (await readModelConfig(id, "l2d_offset_y", (v) => (typeof v === "number" ? v : parseFloat(String(v))), 0)) || 0
		await nextTick()
		relayout()
		motions.value = (await readMotionGroups(id, entryBase)) ?? []
		expressions.value = await readExpressionNames(id, entryBase)
		const runtime = await l2d.getMotions()
		if (runtime && runtime.length) motions.value = runtime
		ready.value = true
	} catch (e: any) {
		error.value = e?.message ?? String(e)
	} finally {
		loading.value = false
	}
}

const pick = (id: string) => {
	if (id === currentModelId.value && ready.value) return
	currentModelId.value = id
	panel.value = ""
	loadModel()
}

const doMotion = (group: string, i: number) => l2d.playMotionByIndex(group, i)

const playRand = () => {
	if (panel.value === "motion") { panel.value = ""; return }
	panel.value = "motion"
}

const playExpr = () => {
	if (panel.value === "expression") { panel.value = ""; return }
	if (!expressions.value.length) {
		l2d.playMotionByIndex("Idle", 0)
	} else {
		panel.value = "expression"
	}
}

const openPanel = (p: P) => { panel.value = panel.value === p ? "" : p }

/* ================= 双指缩放 / 位移 (取代"调整") ================= */

const gesture = reactive<Record<number, {x: number; y: number}>>({})
let pinchBase = {dist: 0, midX: 0, midY: 0, scale: 1, ox: 0, oy: 0}

const onTouchStart = (e: TouchEvent) => {
	for (const t of Array.from(e.touches)) gesture[t.identifier] = {x: t.clientX, y: t.clientY}
	if (Object.keys(gesture).length === 2) {
		const [a, b] = Object.values(gesture)
		pinchBase = {
			dist: Math.hypot(a.x - b.x, a.y - b.y),
			midX: (a.x + b.x) / 2,
			midY: (a.y + b.y) / 2,
			scale: scale.value,
			ox: offsetX.value,
			oy: offsetY.value,
		}
	}
}

const onTouchMove = (e: TouchEvent) => {
	for (const t of Array.from(e.touches)) gesture[t.identifier] = {x: t.clientX, y: t.clientY}
	const pts = Object.values(gesture)
	if (pts.length !== 2) return
	const [a, b] = pts
	const dist = Math.hypot(a.x - b.x, a.y - b.y)
	const midX = (a.x + b.x) / 2
	const midY = (a.y + b.y) / 2
	if (pinchBase.dist > 0) {
		scale.value = clamp(pinchBase.scale * (dist / pinchBase.dist), 0.3, 3)
	}
	// 双指整体平移 = 位移模型
	offsetX.value = clamp(pinchBase.ox + (midX - pinchBase.midX), -500, 500)
	offsetY.value = clamp(pinchBase.oy + (midY - pinchBase.midY), -800, 400)
	relayout()
	saveTransform()
}

const onTouchEnd = (e: TouchEvent) => {
	// 保留残留; 重新形成两指时重新取基准
	const liveSet = new Set(Array.from(e.touches).map((t) => t.identifier))
	for (const id of Object.keys(gesture)) {
		if (!liveSet.has(Number(id))) delete gesture[Number(id)]
	}
	if (Object.keys(gesture).length !== 2) pinchBase = {dist: 0, midX: 0, midY: 0, scale: 1, ox: 0, oy: 0}
}

const saveTransform = () => {
	const id = currentModelId.value
	if (!id) return
	writeModelConfig(id, "l2d_scale", scale.value)
	writeModelConfig(id, "l2d_offset_x", offsetX.value)
	writeModelConfig(id, "l2d_offset_y", offsetY.value)
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/* ================= 涟漪效果 ================= */

const rippleHost = ref<HTMLElement | null>(null)

const spawnRipple = (e: Event) => {
	const btn = (e.target as HTMLElement).closest<HTMLElement>(".ripple")
	if (!btn) return
	const rect = btn.getBoundingClientRect()
	const m = e as MouseEvent
	const span = document.createElement("span")
	const d = Math.max(rect.width, rect.height) * 2
	span.className = "ripple-el"
	span.style.width = span.style.height = `${d}px`
	span.style.left = `${m.clientX - rect.left - d / 2}px`
	span.style.top = `${m.clientY - rect.top - d / 2}px`
	btn.appendChild(span)
	setTimeout(() => span.remove(), 600)
}

/* ================= 聊天 ================= */

const chatOpen = ref(false)
const draft = ref("")
const typing = ref(false)
const messages = ref<ChatMsg[]>([])
const chatScroll = ref<HTMLElement | null>(null)
const modelOptions = ref<string[]>([])
const modelLoadMsg = ref("")

const cfg = reactive({
	apiKey: "",
	baseUrl: "https://api.openai.com/v1",
	model: "",
	bubbleScale: 1,
})

/** 气泡字号随设置实时变化 */
const chatFontPX = computed(() => `${14 * (Number(cfg.bubbleScale) || 1)}px`)
/** 气泡大小数值显示 */
const bubbleScaleNum = computed(() => Number(cfg.bubbleScale) || 1)

const curModelName = computed(() => cfg.model || "未配置模型")

const storageReady = ref(false)

const modelReady = computed(() => !!cfg.apiKey.trim() && !!cfg.model)

const toggleChat = () => {
	chatOpen.value = !chatOpen.value
	if (chatOpen.value) scrollChatBottom()
}

const scrollChatBottom = () => {
	nextTick(() => {
		const el = chatScroll.value
		if (el) el.scrollTop = el.scrollHeight
	})
}

const refreshModels = async () => {
	modelLoadMsg.value = "加载中…"
	const r = await fetchModels(cfg.baseUrl, cfg.apiKey)
	if (!r.ok) { modelLoadMsg.value = r.message ?? "加载失败"; return }
	modelOptions.value = r.models ?? []
	if (modelOptions.value.length && !modelOptions.value.includes(cfg.model)) cfg.model = modelOptions.value[0]
	modelLoadMsg.value = `找到 ${modelOptions.value.length} 个模型`
}

const send = async () => {
	const text = draft.value.trim()
	if (!text || typing.value) return
	if (!modelReady.value) {
		panel.value = "settings"
		return
	}
	draft.value = ""
	messages.value.push({role: "user", content: text, ts: Date.now()})
	persistChat(messages.value)
	scrollChatBottom()

	typing.value = true
	try {
		// 上下文: Nori 人设系统提示词 + 发送指令 + 长期记忆 + 最近 20 条消息
		const memory = readMemory()
		const context: ChatMsg[] = [
			{role: "system", content: PERSONA_PROMPT} as ChatMsg,
			{role: "system", content: DIRECTIVE} as ChatMsg,
		]
		if (memory.trim()) context.push({role: "system", content: `(长期记忆，按需参考)\n${memory.trim()}`} as ChatMsg)
		const hist = messages.value.slice(-20).map(({role, content}) => ({role, content}) as ChatMsg)
		const payload = [...context, ...hist]
		const res = await sendChat(cfg.baseUrl, cfg.apiKey, cfg.model, payload)
		if (res.ok) {
			const reply = res.content ?? ""
			// 分条发送: 按"每句一行"拆分成独立气泡, 逐条模拟真人打字
			const parts = splitReplies(reply)
			for (let i = 0; i < parts.length; i++) {
				if (i > 0) await sleep(400 + Math.random() * 900)
				messages.value.push({role: "assistant", content: parts[i], ts: Date.now()})
				persistChat(messages.value)
				scrollChatBottom()
			}
			// 根据内容自动触发表情动作
			triggerEmotion(reply)
			// 简单记忆: 记住明确以"记住/我叫/我是"等开头的用户陈述
			appendMemoryIfAny(text)
		} else {
			messages.value.push({role: "assistant", content: `⚠ ${res.message ?? "请求失败"}`, ts: Date.now()})
			persistChat(messages.value)
		}
	} finally {
		typing.value = false
		scrollChatBottom()
	}
}

const DIRECTIVE = [
	"追加硬规则，最终优先级最高：",
	"1. 回复中不要使用任何标点符号（不要句号、逗号、省略号、叹号、问号）。",
	"2. 每次回复拆成 2~3 条独立短句，每句自占一行，用换行分隔，模拟真人逐条发送的感觉。",
].join("\n")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 按换行把回复拆成多条; 无换行时退回按常见断句切分 */
const splitReplies = (reply: string): string[] => {
	const lines = reply.split(/\n+/).map((s) => s.trim()).filter((s) => s)
	if (lines.length >= 2) return lines.map((s) => s.replace(/[。！？!?^~，,]+$/g, ""))
	return [reply.trim()]
}

const appendMemoryIfAny = (text: string) => {
	const t = text.trim()
	if (/^(记住|记着|不要忘记|我叫|我是|我的名字|我喜欢|我不喜欢)/.test(t)) {
		appendMemory(t)
	}
}

/* ================= 情绪 → 表情/动作自动联动 ================= */

// 情绪关键词 → 名称里要找的子串 (匹配模型自带的表情名, 如 13_Happy / 05_Angry ...)
const EMOTION_RULES: {key: RegExp; match: string[]}[] = [
	{key: /开心|高兴|happy|哈哈|嘿嘿|太棒|好呀|超棒|真棒|喜欢|开心就|笑嘻嘻|哈哈/, match: ["happy", "smile", "kira"]},
	{key: /生气|讨厌|不喜欢|气死|居然|过分|气鼓/, match: ["angry"]},
	{key: /难过|伤心|失落|孤单|想念|呜呜|哭了|想哭|难受|好想/, match: ["sad", "tears", "troubled", "worried"]},
	{key: /害羞|不好意思|唔\.\.|诶\.\.|脸红了/, match: ["shy"]},
	{key: /困了|好困|累|想睡|睡觉/, match: ["sleep"]},
	{key: /惊讶|诶！|哇|不会吧|真的吗|嚇/, match: ["surprised", "dizzy"]},
	{key: /认真|严肃|重要|承诺|答应/, match: ["serious", "angry"]},
	{key: /无奈|叹气|真是|哎/, match: ["speechless", "doubt", "troubled"]},
]

/** 从回复里挑一个表达式名, 没有匹配则返回空 */
const detectExpression = (text: string): string | null => {
	const lower = text.toLowerCase()
	for (const rule of EMOTION_RULES) {
		if (!rule.key.test(text)) continue
		const hit = expressions.value.find((name) => rule.match.some((k) => name.toLowerCase().includes(k)))
		if (hit) return hit
	}
	return null
}

/** 播放一个随机的待机动作 */
const playIdleMotionOnce = () => {
	const idle = motions.value.find((g) => /idle/i.test(g.group))
	if (idle && idle.names.length) {
		l2d.playMotionByIndex(idle.group, Math.floor(Math.random() * idle.names.length))
	}
}

/** 根据聊天内容自动做表情动作 */
const triggerEmotion = (text: string) => {
	if (!ready.value) return
	const emo = detectExpression(text)
	if (emo) {
		l2d.playExpression(emo)
	} else {
		l2d.stopExpression()
	}
	playIdleMotionOnce()
}

const grantStorage = () => requestStoragePermission()

const saveSettingsNow = () => {
	saveSettings({apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model, bubbleScale: Number(cfg.bubbleScale) || 1})
	modelLoadMsg.value = ""
}

/* ================= 生命周期 ================= */

const onResize = () => relayout()

onMounted(async () => {
	window.addEventListener("resize", onResize)
	// 从系统"所有文件访问"设置页返回后重新检测授权状态
	const refreshStorage = () => { storageReady.value = isStorageReady() }
	window.addEventListener("focus", refreshStorage)
	document.addEventListener("visibilitychange", refreshStorage)

	// 设置 & 聊天 & 记忆
	const s = loadSettings()
	cfg.apiKey = s.apiKey
	cfg.baseUrl = s.baseUrl || "https://api.openai.com/v1"
	cfg.model = s.model
	cfg.bubbleScale = s.bubbleScale || 1
	storageReady.value = isStorageReady()
	messages.value = loadChat()
	if (cfg.apiKey.trim()) refreshModels()

	// 模型列表与恢复上次模型
	try {
		modelList.value = await fetchModelList()
		listError.value = ""
	} catch (e: any) {
		listError.value = "获取模型列表失败: " + (e?.message ?? String(e))
		return
	}
	const installed = await listInstalled()
	if (installed.length) {
		const last = installed.find((i) => modelList.value.some((m) => m.id === i.id)) ?? installed[0]
		currentModelId.value = last.id
	}
	await loadModel()
})

onBeforeUnmount(async () => {
	window.removeEventListener("resize", onResize)
	await l2d.destroy()
})
</script>

<style lang="less" scoped>
.stage-root {
	position: fixed;
	inset: 0;
	background:
		radial-gradient(ellipse at 50% 40%, #1e293b 0%, #0b1220 55%, #050912 100%);
	overflow: hidden;
	touch-action: none;
	user-select: none;
}

.ripple-host { display: none; }

.topbar {
	position: absolute;
	top: 0; left: 0; right: 0;
	padding: calc(10px + env(safe-area-inset-top)) 14px 8px;
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 10px;
	z-index: 4;
	pointer-events: none;
}
.tag, .loading, .err {
	pointer-events: auto;
	padding: 6px 12px;
	border-radius: 999px;
	background: rgba(15, 23, 42, 0.55);
	border: 1px solid rgba(148, 163, 184, 0.25);
	font-size: 13px;
	color: #e2e8f0;
	backdrop-filter: blur(12px);
}
.err { color: #fecaca; border-color: rgba(248, 113, 113, 0.5); background: rgba(127, 29, 29, 0.5); }

/* ===== 涟漪 ===== */
.ripple {
	position: relative;
	overflow: hidden;
}
.ripple-el {
	position: absolute;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.35);
	transform: scale(0);
	animation: ripple-exp 0.55s ease-out forwards;
	pointer-events: none;
}
@keyframes ripple-exp {
	to { transform: scale(1); opacity: 0; }
}

/* ===== 对话面板 ===== */
.chat-panel {
	position: absolute;
	left: 10px; right: 10px;
	bottom: calc(86px + env(safe-area-inset-bottom));
	max-height: 58vh;
	display: flex;
	flex-direction: column;
	background: rgba(15, 23, 42, 0.92);
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 18px;
	backdrop-filter: blur(16px);
	z-index: 12;
	box-shadow: 0 -8px 30px rgba(0,0,0,0.35);
	overflow: hidden;
}
.chat-head {
	display: flex; justify-content: space-between; align-items: center;
	padding: 10px 14px;
	border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}
.chat-title { font-size: 14px; font-weight: 600; color: #f1f5f9; }
.chat-msgs {
	flex: 1; min-height: 120px; overflow-y: auto;
	padding: 12px 14px;
	display: flex; flex-direction: column; gap: 8px;
	line-height: 1.5;
}
.chat-empty { text-align: center; color: #64748b; font-size: 13px; }
.bubble-wrap { display: flex; }
.bubble-wrap.user { justify-content: flex-end; }
.bubble-wrap.assistant { justify-content: flex-start; }
.bubble {
	max-width: 82%;
	padding: 9px 12px;
	border-radius: 14px;
	font-size: 1em;
	white-space: pre-wrap;
	word-break: break-word;
	color: #e2e8f0;
}
.bubble-wrap.user .bubble {
	background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
	color: #fff;
	border-bottom-right-radius: 4px;
}
.bubble-wrap.assistant .bubble {
	background: rgba(51, 65, 85, 0.85);
	border-bottom-left-radius: 4px;
}
.bubble-wrap.assistant .bubble.typing { color: #94a3b8; }
.chat-input {
	display: flex; gap: 8px;
	padding: 10px 12px;
	border-top: 1px solid rgba(148, 163, 184, 0.14);
}
.chat-input input {
	flex: 1;
	background: rgba(30, 41, 59, 0.9);
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 12px;
	padding: 10px 12px;
	color: #e2e8f0;
	font-size: 14px;
	outline: none;
}
.chat-input .send {
	padding: 0 16px;
	border-radius: 12px;
	background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
	color: #fff;
	font-size: 14px;
	font-weight: 600;
	&:disabled { opacity: 0.4; }
}
.chat-enter-active, .chat-leave-active { transition: opacity 0.22s ease, transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1); }
.chat-enter-from, .chat-leave-to { opacity: 0; transform: translateY(16px); }

/* ===== 底栏按钮 ===== */
.dock {
	position: absolute;
	left: 0; right: 0; bottom: 0;
	padding: 10px 10px calc(12px + env(safe-area-inset-bottom));
	display: grid;
	grid-template-columns: repeat(5, 1fr);
	gap: 8px;
	z-index: 5;
	background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(2,6,23,0.7) 45%, rgba(2,6,23,0.95) 100%);
}
.fab {
	padding: 14px 4px;
	border-radius: 16px;
	background: rgba(30, 41, 59, 0.85);
	color: #e2e8f0;
	font-size: 13px;
	border: 1px solid rgba(148, 163, 184, 0.22);
	transition: background 0.2s ease;
	&:active { transform: scale(0.96); }
	&:disabled { opacity: 0.4; pointer-events: none; }
}
.fab.primary {
	background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
	color: #fff;
	font-weight: 600;
	border-color: rgba(255,255,255,0.15);
}

/* ===== 底部面板 ===== */
.sheet-mask {
	position: fixed; inset: 0;
	background: rgba(2,6,23,0.55);
	z-index: 20;
	display: flex; align-items: flex-end;
}
.sheet {
	width: 100%;
	max-height: 74vh;
	background: #0f172a;
	border-top-left-radius: 22px;
	border-top-right-radius: 22px;
	border-top: 1px solid rgba(148, 163, 184, 0.22);
	padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
	display: flex; flex-direction: column;
}
.sheet-head {
	display: flex; justify-content: space-between; align-items: center;
	padding: 8px 2px 12px;
	border-bottom: 1px solid rgba(148, 163, 184, 0.12);
	margin-bottom: 12px;
}
.sheet-title { font-size: 16px; font-weight: 600; color: #f1f5f9; }
.x { width: 32px; height: 32px; border-radius: 50%; color: #cbd5e1; background: rgba(148, 163, 184, 0.14); }
.sheet-body { overflow-y: auto; flex: 1; min-height: 0; }

.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.mc {
	border-radius: 16px; overflow: hidden;
	background: rgba(30, 41, 59, 0.6);
	border: 2px solid transparent;
	cursor: pointer;
	.thumb { width: 100%; height: 130px; background: #1e293b; }
	img { width: 100%; height: 130px; object-fit: cover; display: block; }
	&.on { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2); }
}
.mname { padding: 8px 10px 10px; font-size: 14px; color: #e2e8f0; }

.empty { padding: 24px 0; text-align: center; color: #64748b; font-size: 14px; }
.grp { margin-bottom: 14px; }
.grp-name { font-size: 13px; color: #94a3b8; padding: 6px 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
	padding: 7px 12px; border-radius: 999px;
	position: relative; overflow: hidden;
	background: rgba(51, 65, 85, 0.85);
	border: 1px solid rgba(148, 163, 184, 0.2);
	color: #e2e8f0; font-size: 13px;
	&:active { background: rgba(71, 85, 105, 0.95); }
}
.chip.w { background: rgba(127, 29, 29, 0.5); border-color: rgba(248, 113, 113, 0.3); color: #fecaca; }

/* ===== 设置 ===== */
.settings-row {
	padding: 10px 2px;
	display: flex; flex-direction: column; gap: 6px;
	label { font-size: 13px; color: #cbd5e1; }
	input[type=text], input[type=password] {
		background: rgba(30, 41, 59, 0.9);
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 10px;
		padding: 10px 12px;
		color: #e2e8f0;
		font-size: 14px;
		outline: none;
	}
	input[type=range] { width: 100%; accent-color: #38bdf8; }
}
.model-pick { display: flex; gap: 8px; align-items: center; }
.model-pick select {
	flex: 1;
	background: rgba(30, 41, 59, 0.9);
	color: #e2e8f0;
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 10px;
	padding: 10px;
	font-size: 14px;
}
.mini {
	padding: 9px 14px;
	border-radius: 10px;
	background: rgba(51, 65, 85, 0.85);
	color: #e2e8f0;
	font-size: 13px;
	border: 1px solid rgba(148, 163, 184, 0.22);
	white-space: nowrap;
}
.hint { font-size: 12px; color: #94a3b8; }
.hint.ok { color: #4ade80; }
.hint.bad { color: #fbbf24; }
.btn {
	width: 100%; margin-top: 10px;
	padding: 12px; border-radius: 14px;
	position: relative; overflow: hidden;
	background: rgba(30, 41, 59, 0.85);
	color: #e2e8f0; font-size: 14px;
	border: 1px solid rgba(148, 163, 184, 0.22);
}

.sheet-enter-active, .sheet-leave-active {
	transition: opacity 0.22s ease;
	.sheet { transition: transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1); }
}
.sheet-enter-from, .sheet-leave-to {
	opacity: 0;
	.sheet { transform: translateY(100%); }
}
</style>