<script setup lang="ts">




import {ref, watch} from "vue"
import type {TouchArea} from "../services/live2d/touch"

const props = defineProps<{
	touches: TouchArea[]
	drawing: boolean
	adjusting: boolean
	hasDraft: boolean
}>()

const emit = defineEmits<{
	(e: "toggleDraw"): void
	(e: "toggleAdjust"): void
	(e: "add", t: {name: string; prompt: string}): void
	(e: "update", id: string, patch: Partial<TouchArea>): void
	(e: "remove", id: string): void
	(e: "resetDraft"): void
	(e: "cfgExport"): void
	(e: "cfgImport"): void
}>()


const editingId = ref<string | null>(null)
const editName = ref("")
const editPrompt = ref("")

const name = ref("")
const prompt = ref("")

const pct = (v: number) => `${Math.round(v * 100)}%`

const startEdit = (t: TouchArea) => {
	editingId.value = t.id
	editName.value = t.name
	editPrompt.value = t.prompt || ""
	emit("resetDraft")
}

const cancelEdit = () => {
	editingId.value = null
	editName.value = ""
	editPrompt.value = ""
}

const saveEdit = () => {
	const nm = editName.value.trim() || "未命名"
	if (editingId.value) emit("update", editingId.value, {name: nm, prompt: editPrompt.value})
	cancelEdit()
}

const submitNew = () => {
	emit("add", {name: name.value, prompt: prompt.value})
	name.value = ""
	prompt.value = ""
}

watch(() => props.hasDraft, (has) => {
	if (has) {
		
		editingId.value = null
		if (!name.value) name.value = `区域 ${props.touches.length + 1}`
	}
})
</script>

<template>
	<div class="touch-manager">
		<div class="tm-head">
			<span class="tm-title">自定义触摸区域</span>
		</div>

		<div class="tm-tools">
			<button class="tm-me-btn primary" :class="{on: drawing}" @click="emit('toggleDraw')">
				{{ drawing ? "退出框选" : "＋ 新增区域" }}
			</button>
			<button class="tm-me-btn adj" :class="{on: adjusting}" @click="emit('toggleAdjust')">
				{{ adjusting ? "完成调整" : "调整位置" }}
			</button>
		</div>

		<div class="tm-tools io">
			<button class="tm-me-btn" @click="emit('cfgExport')">导出配置</button>
			<button class="tm-me-btn" @click="emit('cfgImport')">导入配置</button>
		</div>
		<div class="tm-io-hint">导出到 Download/DeepEr/touch_config.json，两台手机间可互拷分享</div>

		<div v-if="drawing" class="tm-hint">在模型上按住拖动画新矩形，松手填写名称</div>
		<div v-else-if="adjusting" class="tm-hint warn">点住已有区域可拖动调整位置</div>

		<ul v-if="touches.length" class="tm-list">
			<li v-for="t in touches" :key="t.id" class="tm-item" :class="{open: editingId === t.id}">
				<div class="tm-item-top">
					<span class="tm-name">{{ t.name }}</span>
					<span class="tm-size">{{ pct(t.w) }} × {{ pct(t.h) }}</span>
				</div>
				<div v-if="t.prompt" class="tm-prompt">{{ t.prompt }}</div>
				<div class="tm-actions">
					<button class="tm-btn" @click="startEdit(t)">编辑</button>
					<button class="tm-btn danger" @click="emit('remove', t.id)">删除</button>
				</div>
				
				<div v-if="editingId === t.id" class="tm-edit">
					<div class="tm-field">
						<label>名称</label>
						<input v-model="editName" type="text" spellcheck="false" placeholder="如：头顶、脸颊、肚皮" />
					</div>
					<div class="tm-field">
						<label>提示词（把这段描述发给 AI，想让它怎么反应写这里）</label>
						<input v-model="editPrompt" type="text" spellcheck="false" placeholder="留空则用名称；写得好玩点 AI 会更有戏" />
					</div>
					<div class="tm-edit-actions">
						<button class="tm-btn" @click="cancelEdit">取消</button>
						<button class="tm-btn primary" @click="saveEdit">保存</button>
					</div>
				</div>
			</li>
		</ul>
		<p v-else-if="!hasDraft" class="tm-empty">
			还没有触摸区域。<br/>点「＋ 新增区域」，然后在模型上画矩形。
		</p>

		
		<div v-if="hasDraft" class="tm-edit tm-new">
			<div class="tm-field">
				<label>名称</label>
				<input v-model="name" type="text" spellcheck="false" placeholder="如：头顶、脸颊、肚皮" />
			</div>
			<div class="tm-field">
				<label>提示词（触摸后发给 AI 的描述，可选）</label>
				<input v-model="prompt" type="text" spellcheck="false" placeholder="写点有趣的，AI 每次反应都会不一样" />
			</div>
			<div class="tm-edit-actions">
				<button class="tm-btn" @click="emit('resetDraft')">取消</button>
				<button class="tm-btn primary" @click="submitNew">添加</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.touch-manager { display: flex; flex-direction: column; gap: 10px; }
.tm-head { display: flex; align-items: center; }
.tm-title { font-size: 14px; font-weight: 600; color: #f1f5f9; }
.tm-tools { display: flex; gap: 8px; }
.tm-tools.io { margin-top: -2px; }
.tm-io-hint { font-size: 11px; color: #64748b; line-height: 1.5; }
.tm-me-btn {
	flex: 1;
	padding: 9px 0;
	border-radius: 10px;
	font-size: 13px;
	border: 1px solid rgba(148, 163, 184, 0.22);
	background: rgba(51, 65, 85, 0.85);
	color: #e2e8f0;
}
.tm-me-btn.primary.on { background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); color: #fff; }
.tm-me-btn.adj { background: rgba(30, 41, 59, 0.8); color: #7dd3fc; }
.tm-me-btn.adj.on { background: rgba(56, 189, 248, 0.18); border-color: rgba(56, 189, 248, 0.6); color: #7dd3fc; }
.tm-hint {
	font-size: 12px; color: #fbbf24; background: rgba(251,191,36,0.12);
	border-radius: 8px; padding: 8px 10px; line-height: 1.6;
}
.tm-hint.warn { color: #7dd3fc; background: rgba(56, 189, 248, 0.12); }
.tm-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; }
.tm-item {
	border-radius: 10px; padding: 10px 12px;
	background: rgba(30,41,59,0.6); border-left: 3px solid #60a5fa;
}
.tm-item.open { border-color: #7dd3fc; }
.tm-item-top { display: flex; align-items: center; gap: 6px; }
.tm-name { flex: 1; font-size: 13px; color: #e2e8f0; }
.tm-size { font-size: 11px; color: #94a3b8; }
.tm-prompt { margin-top: 4px; font-size: 12px; color: #94a3b8; }
.tm-actions { margin-top: 8px; display: flex; gap: 8px; }
.tm-btn {
	padding: 6px 12px; font-size: 12px; border-radius: 8px;
	background: rgba(51,65,85,0.85); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.2);
	&.danger { color: #fca5a5; }
	&.primary { background: linear-gradient(135deg,#38bdf8,#6366f1); color: #fff; }
}
.tm-empty { text-align: center; color: #64748b; font-size: 13px; padding: 8px 0; line-height: 1.6; }
.tm-edit {
	border-radius: 12px; padding: 12px;
	background: rgba(30,41,59,0.7); border: 1px solid rgba(148,163,184,0.2);
	display: flex; flex-direction: column; gap: 8px;
	margin-top: 10px;
}
.tm-new { border-color: rgba(56,189,248,0.45); background: rgba(30,41,59,0.85); }
.tm-field { display: flex; flex-direction: column; gap: 5px; label { font-size: 12px; color: #94a3b8; } }
.tm-field input {
	background: rgba(30,41,59,0.9); border: 1px solid rgba(148,163,184,0.25);
	border-radius: 8px; padding: 9px 11px; color: #e2e8f0; font-size: 13px; outline: none;
}
.tm-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 680px) and (max-height: 500px) {
	.tm-title { font-size: 13px; }
	.tm-me-btn { padding: 8px 0; font-size: 12px; }
	.tm-hint { font-size: 11px; padding: 7px 9px; }
	.tm-item { padding: 8px 10px; }
	.tm-name { font-size: 12px; }
	.tm-size { font-size: 10px; }
	.tm-prompt { font-size: 11px; }
	.tm-btn { padding: 6px 10px; font-size: 11px; }
	.tm-empty { font-size: 12px; }
	.tm-edit { padding: 10px; }
	.tm-field label { font-size: 11px; }
	.tm-field input { padding: 8px 10px; font-size: 12px; }
}
</style>
