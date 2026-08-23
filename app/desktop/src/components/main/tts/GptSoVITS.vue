<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue"
import {invoke} from "@tauri-apps/api/core"
import {open} from "@tauri-apps/plugin-dialog"
import useLanguages from "../../../services/i18n/useLanguages.ts"
import {logger} from "../../../services/logger"
import {defaultConfig, GPT_SOVITS_LANGUAGES, GPT_SOVITS_SPLIT_METHODS, loadConfig, saveConfig, type GptSoVitsConfig,} from "../../../services/tts/gptsovits"
import {assetUrl} from "../../../services/asset.ts"
import {useUnsavedGuard} from "../../../services/store/unsaved.ts"
import {useTTSStore} from "../../../services/store/tts.ts"
import Icon from "../../common/Icon.vue"
import type {TTSVoiceEntry} from "../../../services/tts/types"

const I18N = computed(() => useLanguages().components.main.tts.gptSovits)

const TTS_I18N = computed(() => useLanguages().components.main.tts)

const COMMON_I18N = computed(() => useLanguages().common.label)

const GUARD = useUnsavedGuard()

// TTS 统一状态入口 (合成 / 测试按激活适配器路由)
const TTS_STORE = useTTSStore()

// 配置
const config = ref<GptSoVitsConfig>(defaultConfig())

// 是否已加载完成
const loaded = ref(false)

// 是否有未保存修改
const dirty = ref(false)

const GUARD_SYNC = () => ({
	hasUnsaved: () => dirty.value,
	onSave: async () => save(),
	title: TTS_I18N.value.unsavedTitle,
	message: TTS_I18N.value.unsavedMessage,
	saveLabel: TTS_I18N.value.saveAndLeave,
	discardLabel: TTS_I18N.value.discardLeave,
})

// 加载配置
onMounted(async () => {
	config.value = await loadConfig()
	loaded.value = true
	await TTS_STORE.init()
	GUARD.register(GUARD_SYNC())
})

onBeforeUnmount(() => {
	GUARD.unregister()
})

// 标记修改
const markDirty = () => {
	if (loaded.value) dirty.value = true
}

watch(config, markDirty, {deep: true, flush: "sync"})

// 测试连接状态
const testing = computed(() => TTS_STORE.testing)

// 测试连接结果
const testResult = ref<{ ok: boolean; message: string } | null>(null)

// 测试连接 (统一走 store, 由激活适配器按其协议测试)
const testConnection = async () => {
	if (dirty.value) {
		if (saving.value) return
		const OK = await save()
		if (!OK) return
	}
	testResult.value = null
	const RESULT = await TTS_STORE.testConnection()
	if (!RESULT) {
		testResult.value = {ok: false, message: "未启用 TTS 适配器"}
		return
	}
	if (RESULT.ok) {
		let hint = ""
		if (typeof RESULT.status === "number") {
			if (RESULT.status >= 500) hint = TTS_I18N.value.gatewayHint
			else if (RESULT.status === 404) hint = TTS_I18N.value.statusNotFound
			else if (RESULT.status >= 400) hint = TTS_I18N.value.statusClientError
			else hint = TTS_I18N.value.endpointReachable
		}
		testResult.value = {ok: true, message: hint ? `${RESULT.status} · ${hint}` : `${RESULT.status}`}
	} else {
		testResult.value = {ok: false, message: RESULT.error || "连接失败"}
	}
}

// 情绪参考音频
type Drawer = { type: "add" } | { type: "edit"; index: number } | null

// 当前展开的抽屉, null = 全部收起
const drawer = ref<Drawer>(null)

// 情绪名
const editName = ref("")

// 音频路径
const editAudioPath = ref("")

// 提示文本
const editPromptText = ref("")

// 参考音频语言 (所属条目独立)
const editPromptLang = ref("zh")

// 抽屉内校验错误
const editError = ref("")

// 是否新增
const isAdding = computed(() => drawer.value?.type === "add")

// 打开新增抽屉
const startAdd = () => {
	drawer.value = {type: "add"}
	editName.value = ""
	editAudioPath.value = ""
	editPromptText.value = ""
	editPromptLang.value = "zh"
	editError.value = ""
}

// 点击某条: 已是编辑态则收起, 否则展开该条抽屉
const toggleDrawer = (index: number) => {
	if (drawer.value && drawer.value.type === "edit" && drawer.value.index === index) {
		drawer.value = null
		return
	}
	const ITEM = config.value.emotions[index]
	if (!ITEM) return
	drawer.value = {type: "edit", index}
	editName.value = ITEM.name
	editAudioPath.value = ITEM.audioPath
	editPromptText.value = ITEM.promptText
	editPromptLang.value = ITEM.promptLang || "zh"
	editError.value = ""
}

// 关闭抽屉
const closeDrawer = () => {
	drawer.value = null
	editName.value = ""
	editAudioPath.value = ""
	editPromptText.value = ""
	editPromptLang.value = "zh"
	editError.value = ""
}

// 情绪名是否重复 (排除当前正在编辑的那一条)
const nameDuplicate = computed(() => {
	const NAME = editName.value.trim()
	if (!NAME) return false
	return config.value.emotions.some((item, i) => {
		if (drawer.value?.type === "edit" && drawer.value.index === i) return false
		return item.name === NAME
	})
})

// 确认新增/更新条目
const confirmEdit = () => {
	const NAME = editName.value.trim()
	if (!NAME) {
		editError.value = I18N.value.errorNameEmpty
		return
	}
	if (nameDuplicate.value) {
		editError.value = I18N.value.errorNameDuplicate
		return
	}
	const AUDIO_PATH = editAudioPath.value.trim()
	if (!AUDIO_PATH) {
		editError.value = I18N.value.errorAudioEmpty
		return
	}
	editError.value = ""
	const ENTRY: TTSVoiceEntry = {
		name: NAME,
		audioPath: AUDIO_PATH,
		promptText: editPromptText.value.trim(),
		promptLang: editPromptLang.value || "zh",
	}
	const WAS_ADDING = isAdding.value
	if (WAS_ADDING) {
		config.value.emotions.push(ENTRY)
	} else if (drawer.value?.type === "edit") {
		config.value.emotions[drawer.value.index] = ENTRY
	}
	closeDrawer()
	markDirty()
}

// 删除条目
const removeEmotion = (index: number) => {
	if (drawer.value?.type === "edit" && drawer.value.index === index) closeDrawer()
	config.value.emotions.splice(index, 1)
	markDirty()
}

// 选择单个音频文件 (填入当前抽屉字段)
const pickAudioFile = async () => {
	const SELECTED = await open({
		multiple: false,
		directory: false,
		filters: [{
			name: I18N.value.audioFilter,
			extensions: ["wav", "mp3", "ogg", "aac", "flac", "m4a", "opus", "webm"]
		}],
		title: I18N.value.pickAudioTitle,
	})
	if (typeof SELECTED === "string") editAudioPath.value = SELECTED
}

// 扫描音频文件夹
const scanningDir = ref(false)

// 扫描结果 / 错误
const scanMsg = ref("")

// 扫描音频文件夹
const scanFolder = async () => {
	const DIR = await open({multiple: false, directory: true, title: I18N.value.scanDirTitle})
	if (typeof DIR !== "string" || !DIR) return
	scanMsg.value = ""
	scanningDir.value = true
	try {
		const FILES = await invoke<string[]>("tts_list_audio_files", {dir: DIR})
		if (!FILES.length) {
			scanMsg.value = I18N.value.scanEmpty
			return
		}
		for (const FILE of FILES) {
			const NAME = fileNameWithoutExt(FILE)
			if (!NAME) continue
			if (config.value.emotions.some(item => item.name === NAME || item.audioPath === FILE)) continue
			config.value.emotions.push({name: NAME, audioPath: FILE, promptText: "", promptLang: "zh"})
		}
		markDirty()
		await logger.info(`扫描音频文件夹: ${DIR} 共 ${FILES.length} 个`)
	} catch (error) {
		scanMsg.value = I18N.value.scanFail
		await logger.error("扫描音频文件夹失败", error)
	} finally {
		scanningDir.value = false
	}
}

// 获取文件名 (不包含扩展名)
const fileNameWithoutExt = (path: string): string => {
	const BASE = path.split(/[\\/]/).pop() || path
	const DOT = BASE.lastIndexOf(".")
	return DOT > 0 ? BASE.slice(0, DOT) : BASE
}

// 测试合成
const testText = ref("")

// 测试情绪索引
const testEmotionIndex = ref(-1)

// 是否正在合成 (统一由 store 管理)
const synthesizing = computed(() => TTS_STORE.synthesizing)

// 合成的 asset 路径
const synthAudio = ref("")

// 合成错误
const synthError = ref("")

// 合成音频播放元素
const synthAudioEl = ref<HTMLAudioElement | null>(null)

// 是否正在播放合成音频
const synthPlaying = ref(false)

// 切换合成音频播放状态
const toggleSynthPlay = () => {
	const EL = synthAudioEl.value
	if (!EL) return
	if (synthPlaying.value) {
		EL.pause()
	} else {
		void EL.play()
	}
}

// 合成音频播放结束 → 复位播放按钮
const onSynthEnded = () => {
	synthPlaying.value = false
}

// 参考音频预览播放
const refAudioEl = ref<HTMLAudioElement | null>(null)

// 当前正在播放的参考音频路径 (null = 无)
const playingAudioPath = ref("")

// 播放中的对象 URL, 结束时回收
const playingObjectUrl = ref("")

// 读取/启动播放是否进行中
const playingLoading = ref("")

// 参考音频播放错误提示 (独立于合成错误)
const playError = ref("")

// 播放 / 停止一段本地参考音频 (经 Tauri 读字节, 用 Blob 转可播放 URL)
const toggleRefAudio = async (audioPath: string) => {
	if (!audioPath.trim()) return
	playError.value = ""
	// 已在该路径播放 → 停止
	if (playingAudioPath.value === audioPath) {
		stopRefAudio()
		return
	}
	// 切换目标 → 先彻底停止上一个
	stopRefAudio()
	playingLoading.value = audioPath
	try {
		const BYTES = await invoke<number[]>("tts_read_audio_file", {path: audioPath})
		const UINT8 = Uint8Array.from(BYTES)
		const MIME = audioMime(audioPath) || "audio/mpeg"
		const OBJ_URL = URL.createObjectURL(new Blob([UINT8], {type: MIME}))
		playingObjectUrl.value = OBJ_URL
		playingAudioPath.value = audioPath
		if (refAudioEl.value) {
			refAudioEl.value.src = OBJ_URL
			await refAudioEl.value.play()
		}
	} catch (error) {
		await logger.error("播放参考音频失败", error)
		playError.value = I18N.value.refPlayFileMissing
		stopRefAudio()
	} finally {
		playingLoading.value = ""
	}
}

// 停止参考音频播放并回收对象 URL
const stopRefAudio = () => {
	if (refAudioEl.value) {
		refAudioEl.value.pause()
		refAudioEl.value.removeAttribute("src")
		refAudioEl.value.load()
	}
	if (playingObjectUrl.value) {
		URL.revokeObjectURL(playingObjectUrl.value)
		playingObjectUrl.value = ""
	}
	playingAudioPath.value = ""
}

// 根据参考音频扩展名推断 MIME, 供 Blob 使用
const audioMime = (path: string): string => {
	const EXT = (path.split(".").pop() || "").toLowerCase()
	const TABLE: Record<string, string> = {
		wav: "audio/wav",
		mp3: "audio/mpeg",
		ogg: "audio/ogg",
		aac: "audio/aac",
		flac: "audio/flac",
		m4a: "audio/mp4",
		opus: "audio/ogg",
		webm: "audio/webm",
	}
	return TABLE[EXT] || ""
}

// 是否可以合成
const canSynthesize = computed(() => !!testText.value.trim() && testEmotionIndex.value >= 0 && config.value.emotions[testEmotionIndex.value]?.audioPath.trim())

// 合成测试 (统一走 store, 由激活适配器按其协议合成)
const synthesize = async () => {
	if (!canSynthesize.value) return
	synthAudio.value = ""
	synthError.value = ""
	synthPlaying.value = false
	if (dirty.value) {
		if (saving.value) return
		const OK = await save()
		if (!OK) return
	}
	const VOICE = config.value.emotions[testEmotionIndex.value]?.name
	const RESULT = await TTS_STORE.synthesize({
		text: testText.value.trim(),
		voice: VOICE,
	})
	if (RESULT.ok && RESULT.audioAssetPath) {
		synthAudio.value = assetUrl(RESULT.audioAssetPath)
	} else {
		synthError.value = RESULT.error || TTS_I18N.value.synthFail
	}
}

// 是否正在保存
const saving = ref(false)

// 保存错误
const saveError = ref("")

// 保存配置, 返回是否保存成功
const save = async (): Promise<boolean> => {
	saving.value = true
	saveError.value = ""
	try {
		config.value.topK = normalizeInt(config.value.topK, 0)
		config.value.batchSize = Math.max(1, normalizeInt(config.value.batchSize, 1))
		await saveConfig(config.value)
		dirty.value = false
		void TTS_STORE.refreshVoices()
		return true
	} catch (error) {
		saveError.value = String(error)
		await logger.error("保存 GPT-SoVITS 配置失败", error)
		return false
	} finally {
		saving.value = false
	}
}

// 整数键兜底归整, 避免小数入库
const normalizeInt = (value: number, fallback: number): number => {
	const N = Math.round(value)
	return Number.isFinite(N) ? N : fallback
}
</script>

<template>
	<div class="gsp">
		<section class="gsp-card">
			<h3 class="gsp-title">{{ TTS_I18N.serverTitle }}</h3>
			<div class="gsp-row">
				<label class="field grow">
					<span class="field-label">{{ COMMON_I18N.url }}</span>
					<input v-model="config.baseUrl" class="input" type="text" placeholder="http://127.0.0.1:9880" spellcheck="false">
				</label>
				<button class="btn test-btn" :disabled="testing" @click="testConnection">
					<Icon v-if="testing" name="loading" class="spin" :size="14"/>
					{{ testing ? TTS_I18N.testing : COMMON_I18N.test }}
				</button>
			</div>
			<p v-if="testResult" class="test-result" :class="{ok: testResult.ok, fail: !testResult.ok}">
				{{ testResult.message }}
			</p>
		</section>
		<section class="gsp-card">
			<h3 class="gsp-title">{{ TTS_I18N.paramsTitle }}</h3>
			<div class="gsp-grid">
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.topK }}</span>
					<input v-model.number="config.topK" class="input" type="number" min="0" step="1">
				</label>
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.topP }}</span>
					<input v-model.number="config.topP" class="input" type="number" min="0" max="1" step="0.05">
				</label>
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.temperature }}</span>
					<input v-model.number="config.temperature" class="input" type="number" min="0" step="0.05">
				</label>
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.batchSize }}</span>
					<input v-model.number="config.batchSize" class="input" type="number" min="1" step="1">
				</label>
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.textSplitMethod }}</span>
					<select v-model="config.textSplitMethod" class="input select">
						<option v-for="m in GPT_SOVITS_SPLIT_METHODS" :key="m" :value="m">{{ m }}</option>
					</select>
				</label>
			</div>
		</section>
		<section class="gsp-card">
			<div class="gsp-card-head">
				<h3 class="gsp-title">{{ I18N.emotionsTitle }}</h3>
				<div class="head-actions">
					<button class="btn ghost" :disabled="scanningDir" @click="scanFolder">
						<Icon v-if="scanningDir" name="loading" class="spin" :size="14"/>
						<Icon v-else name="import" :size="14"/>
						{{ I18N.scanDir }}
					</button>
					<button class="btn" @click="startAdd">
						<Icon name="add" :size="14"/>
						{{ COMMON_I18N.add }}
					</button>
				</div>
			</div>
			<p v-if="scanMsg" class="inline-error">{{ scanMsg }}</p>
			<p class="duration-hint">{{ I18N.refDurationHint }}</p>
			<p v-if="playError" class="inline-error">{{ playError }}</p>
			<div class="emotion-body">
				<div v-if="drawer && drawer.type === 'add'" class="drawer drawer-add">
					<div class="drawer-form">
						<label class="field">
							<span class="field-label">{{ I18N.editName }}</span>
							<input v-model="editName" class="input" :class="{invalid: nameDuplicate}" type="text"
								   :placeholder="I18N.editNamePlaceholder">
							<span v-if="nameDuplicate" class="field-hint error">{{ I18N.errorNameDuplicate }}</span>
						</label>
						<label class="field">
							<span class="field-label">{{ I18N.editAudioPath }}</span>
							<span class="path-row">
								<input v-model="editAudioPath" class="input" type="text" spellcheck="false"
									   :placeholder="'D:/ref/xxx.wav'">
								<button class="btn ghost" @click="pickAudioFile">
									<Icon name="folder" :size="14"/>
									{{ COMMON_I18N.browse }}
								</button>
							</span>
						</label>
						<label class="field full">
							<span class="field-label">{{ I18N.editPromptText }}</span>
							<textarea
								v-model="editPromptText"
								class="input textarea"
								:placeholder="I18N.editPromptTextPlaceholder"
							/>
						</label>
						<label class="field">
							<span class="field-label">{{ COMMON_I18N.promptLang }}</span>
							<select v-model="editPromptLang" class="input select">
								<option v-for="l in GPT_SOVITS_LANGUAGES" :key="l" :value="l">{{ l }}</option>
							</select>
						</label>
					</div>
					<div class="drawer-actions">
						<button class="btn ghost" @click="closeDrawer">
							<Icon name="close" :size="14"/>
							{{ COMMON_I18N.cancel }}
						</button>
						<button class="btn primary" @click="confirmEdit">
							<Icon name="check" :size="14"/>
							{{ COMMON_I18N.add }}
						</button>
					</div>
					<p v-if="editError" class="inline-error">{{ editError }}</p>
				</div>
				<ul v-if="config.emotions.length" class="emotion-list">
					<li
						v-for="(item, index) in config.emotions"
						:key="item.name"
						class="emotion-item"
						:class="{editing: drawer && drawer.type === 'edit' && drawer.index === index}"
					>
						<div class="emotion-head" @click="toggleDrawer(index)">
							<span class="emotion-name">{{ item.name }}</span>
							<span class="emotion-path" :title="item.audioPath">{{ item.audioPath || '—' }}</span>
							<span v-if="item.promptText" class="emotion-prompt"
								  :title="item.promptText">{{ item.promptText }}</span>
							<button
								v-if="item.audioPath"
								class="mini play"
								:class="{active: playingAudioPath === item.audioPath}"
								:title="I18N.playRefAudio"
								:disabled="!!playingLoading"
								@click.stop="toggleRefAudio(item.audioPath)"
							>
								<Icon
									v-if="playingLoading === item.audioPath"
									name="loading"
									class="spin"
									:size="13"
								/>
								<Icon v-else name="volume" :size="13"/>
							</button>
							<button class="mini del" @click.stop="removeEmotion(index)">
								<Icon name="close" :size="13"/>
							</button>
						</div>
						<div v-if="drawer && drawer.type === 'edit' && drawer.index === index" class="drawer">
							<div class="drawer-form">
								<label class="field">
									<span class="field-label">{{ I18N.editName }}</span>
									<input
										v-model="editName"
										class="input"
										:class="{invalid: nameDuplicate}"
										type="text"
										:placeholder="I18N.editNamePlaceholder"
									>
									<span v-if="nameDuplicate" class="field-hint error">
										{{ I18N.errorNameDuplicate }}
									</span>
								</label>
								<label class="field">
									<span class="field-label">{{ I18N.editAudioPath }}</span>
									<span class="path-row">
										<input
											v-model="editAudioPath"
											class="input"
											type="text"
											spellcheck="false"
											:placeholder="'D:/ref/xxx.wav'"
										>
										<button class="btn ghost" @click="pickAudioFile">
											<Icon name="folder" :size="14"/>
											{{ COMMON_I18N.browse }}
										</button>
									</span>
								</label>
								<label class="field full">
									<span class="field-label">{{ I18N.editPromptText }}</span>
									<textarea
										v-model="editPromptText"
										class="input textarea"
										:placeholder="I18N.editPromptTextPlaceholder"
									/>
								</label>
									<label class="field">
										<span class="field-label">{{ COMMON_I18N.promptLang }}</span>
										<select v-model="editPromptLang" class="input select">
											<option v-for="l in GPT_SOVITS_LANGUAGES" :key="l" :value="l">{{ l }}</option>
										</select>
									</label>
							</div>
							<div class="drawer-actions">
								<button class="btn ghost" @click="closeDrawer">
									<Icon name="close" :size="14"/>
									{{ COMMON_I18N.cancel }}
								</button>
								<button class="btn primary" @click="confirmEdit">
									<Icon name="check" :size="14"/>
									{{ COMMON_I18N.save }}
								</button>
							</div>
							<p v-if="editError" class="inline-error">{{ editError }}</p>
						</div>
					</li>
				</ul>
				<p v-else-if="!drawer" class="emotion-empty">{{ I18N.emotionsEmpty }}</p>
			</div>
		</section>
		<section class="gsp-card">
			<h3 class="gsp-title">{{ TTS_I18N.synthTitle }}</h3>
			<div class="synth-block">
				<label class="field">
					<span class="field-label">{{ TTS_I18N.synthEmotion }}</span>
					<select v-model.number="testEmotionIndex" class="input select">
						<option value="-1" disabled>{{ TTS_I18N.synthEmotionPlaceholder }}</option>
						<option v-for="(item, index) in config.emotions" :key="item.name" :value="index">
							{{item.name }}
						</option>
					</select>
				</label>
				<label class="field">
					<span class="field-label">{{ TTS_I18N.synthText }}</span>
					<textarea v-model="testText" class="input textarea" :placeholder="TTS_I18N.synthTextPlaceholder"/>
				</label>
				<label class="field">
					<span class="field-label">{{ COMMON_I18N.textLang }}</span>
					<select v-model="config.textLang" class="input select">
						<option v-for="l in GPT_SOVITS_LANGUAGES" :key="l" :value="l">{{ l }}</option>
					</select>
				</label>
				<div class="synth-actions">
					<button class="btn primary synth-btn" :disabled="!canSynthesize || synthesizing" @click="synthesize">
						<Icon v-if="synthesizing" name="loading" class="spin" :size="14"/>
						<Icon v-else name="volume" :size="14"/>
						{{ synthesizing ? TTS_I18N.synthing : TTS_I18N.synthesize }}
					</button>
					<div v-if="synthAudio" class="synth-player">
						<button
							class="btn ghost synth-play-btn"
							:class="{playing: synthPlaying}"
							@click="toggleSynthPlay"
						>
							<Icon
								:name="synthPlaying ? 'pause' : 'play'"
								mode="fill"
								:size="14"
							/>
							{{ synthPlaying ? TTS_I18N.playing : TTS_I18N.play }}
						</button>
						<audio
							ref="synthAudioEl"
							:src="synthAudio"
							class="synth-audio"
							@play="synthPlaying = true"
							@pause="synthPlaying = false"
							@ended="onSynthEnded"
						/>
					</div>
				</div>
				<p v-if="synthError" class="inline-error">{{ synthError }}</p>
			</div>
		</section>
		<div class="gsp-savebar">
			<button class="btn primary save-btn" :disabled="saving" @click="save">
				<Icon v-if="saving" name="loading" class="spin" :size="14"/>
				<Icon v-else name="check" :size="14"/>
				{{ COMMON_I18N.saveConfig }}
			</button>
			<p v-if="saveError" class="inline-error">{{ saveError }}</p>
		</div>
		<audio ref="refAudioEl" class="ref-audio-hidden" :style="{visibility: 'hidden', position: 'fixed', width: '1px', height: '1px'}" @ended="stopRefAudio"/>
	</div>
</template>

<style scoped lang="less">
.gsp {
	flex: 1;
	padding: 0.2rem 0.2rem 1rem;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 1.2rem;
	box-sizing: border-box;
}

.gsp-card {
	padding: 1.1rem 1.2rem;
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.02);
	box-sizing: border-box;
}

.gsp-title {
	margin: 0;
	font-size: 1.3rem;
	font-weight: 600;
	color: var(--deep-teal-bright);
	text-shadow: 0 0 1.2rem var(--glow-teal-soft);
}

.gsp-card-head {
	display: flex;
	align-items: center;
	justify-content: space-between;

	.head-actions {
		display: flex;
		gap: 0.6rem;
	}
}

.gsp-row {
	display: flex;
	align-items: flex-end;
	gap: 0.9rem;

	.grow {
		flex: 1;
	}
}

.gsp-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 0.9rem 1rem;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;

	&.full {
		grid-column: 1 / -1;
	}
}

.field-label {
	font-size: 1.05rem;
	color: var(--text-muted);
}

.field-hint {
	font-size: 0.95rem;

	&.error {
		color: var(--danger);
	}
}

.input {
	padding: 0.65rem 0.9rem;
	width: 100%;
	box-sizing: border-box;
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.04);
	color: var(--text-primary);
	font-size: 1.15rem;
	font-family: inherit;
	outline: none;
	transition: all 0.2s ease;

	&:focus {
		border-color: var(--deep-teal-soft);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}

	&.invalid {
		border-color: var(--danger);
		box-shadow: 0 0 0.6rem rgba(251, 44, 54, 0.3);
	}

	&::placeholder {
		color: var(--text-muted);
		opacity: 0.6;
	}
}

.textarea {
	min-height: 5.4rem;
	resize: vertical;
	line-height: 1.6;
}

.select {
	cursor: pointer;

	option {
		color: var(--text-primary);
		background-color: var(--bg-deep);
	}
}

.btn {
	padding: 0.7rem 1.2rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	border: none;
	border-radius: var(--radius-sm);
	background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
	color: #05121a;
	font-size: 1.15rem;
	font-weight: 600;
	font-family: inherit;
	white-space: nowrap;
	cursor: pointer;
	transition: all 0.2s ease;
	flex-shrink: 0;

	&:hover:not(:disabled) {
		box-shadow: 0 0 1.4rem var(--glow-teal-soft);
	}

	&:disabled {
		opacity: 0.55;
		cursor: default;
	}

	&.ghost {
		border: 0.1rem solid var(--line-strong);
		background-image: none;
		background-color: rgba(125, 227, 255, 0.06);
		color: var(--deep-teal-bright);

		&:hover:not(:disabled) {
			box-shadow: 0 0 0.8rem var(--glow-teal-soft);
		}
	}

	&.primary {
		background-image: linear-gradient(90deg, var(--deep-teal-bright), var(--deep-teal));
		color: #05121a;
	}
}

.spin {
	animation: gsp-spin 1s linear infinite;
}

@keyframes gsp-spin {
	to {
		transform: rotate(360deg);
	}
}

.test-btn {
	height: 3.5rem;
}

.test-result {
	margin: 0;
	font-size: 1.05rem;

	&.ok {
		color: var(--deep-teal-bright);
	}

	&.fail {
		color: var(--danger);
	}
}

.duration-hint {
	margin: 0;
	font-size: 1rem;
	color: var(--text-faint);
}

.inline-error {
	margin: 0;
	font-size: 1.05rem;
	color: var(--danger);
}

.path-row {
	display: flex;
	gap: 0.6rem;

	.input {
		flex: 1;
	}
}

.emotion-body {
	min-height: 4rem;
}

.emotion-list {
	padding: 0;
	margin: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.emotion-item {
	border: 0.1rem solid var(--line-subtle);
	border-radius: var(--radius-sm);
	background-color: rgba(255, 255, 255, 0.03);
	transition: all 0.18s ease;

	&.editing {
		border-color: var(--deep-teal-soft);
		box-shadow: 0 0 0.8rem var(--glow-teal-soft);
	}
}

.emotion-head {
	padding: 0.55rem 0.8rem;
	display: flex;
	align-items: center;
	gap: 0.8rem;
	cursor: pointer;

	&:hover {
		background-color: rgba(125, 227, 255, 0.07);
	}

	.emotion-name {
		flex-shrink: 0;
		padding: 0.15rem 0.6rem;
		font-size: 1.1rem;
		font-weight: 600;
		border-radius: 0.5rem;
		background-color: color-mix(in srgb, var(--deep-teal-soft) 22%, transparent);
		color: var(--deep-teal-bright);
	}

	.emotion-path {
		flex: 1;
		min-width: 0;
		font-size: 1.05rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.emotion-prompt {
		max-width: 18rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1rem;
		color: var(--text-faint);
	}
}

.mini {
	width: 2rem;
	height: 2rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: none;
	border-radius: var(--radius-sm);
	background-color: transparent;
	color: var(--text-muted);
	cursor: pointer;
	flex-shrink: 0;
	transition: all 0.18s ease;

	&.play:hover {
		color: var(--deep-teal-bright);
		background-color: rgba(125, 227, 255, 0.12);
	}

	&.play.active {
		color: var(--deep-teal-bright);
		background-color: rgba(125, 227, 255, 0.18);
	}

	&.play:disabled {
		opacity: 0.6;
		cursor: default;
	}

	&.del:hover {
		color: var(--danger);
		background-color: rgba(251, 44, 54, 0.12);
	}
}

.emotion-empty {
	padding: 1rem 0;
	margin: 0;
	font-size: 1.05rem;
	text-align: center;
	color: var(--text-muted);
}

.drawer {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	padding: 1rem;
	border-top: 0.1rem solid var(--line-subtle);
	animation: drawer-in 0.18s ease;

	&.drawer-add {
		border: 0.1rem solid var(--line-subtle);
		border-radius: var(--radius-sm);
		margin-bottom: 0.45rem;
	}
}

@keyframes drawer-in {
	from {
		opacity: 0;
		transform: translateY(-0.4rem);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

.drawer-form {
	display: grid;
	grid-template-columns: 1fr 2fr;
	gap: 0.9rem 1rem;

	.field.full {
		grid-column: 1 / -1;
	}
}

.drawer-actions {
	display: flex;
	justify-content: flex-end;
	gap: 0.7rem;
}

.synth-block {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
}

.synth-btn {
	align-self: unset;
}

// 合成按钮与播放按钮同处一行
.synth-actions {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	flex-wrap: wrap;
}

// 合成音频自定义播放器: 隐藏原生 <audio>, 用自定义按钮控制
.synth-player {
	display: flex;
	align-items: center;
	gap: 0.8rem;
}

.synth-audio {
	width: 1px;
	height: 1px;
	opacity: 0;
	position: fixed;
	pointer-events: none;
}

.synth-play-btn {
	align-self: unset;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;

	&.playing {
		box-shadow: 0 0 1.4rem var(--glow-teal-soft);
	}
}

.gsp-savebar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	padding: 0.4rem 0;
	flex-shrink: 0;
}

.save-btn {
	padding: 0.85rem 2rem;
}
</style>
