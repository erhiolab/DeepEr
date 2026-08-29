



import NORI_PROMPT from "./nori-prompt.md?raw"


export const PERSONA_PROMPT: string = NORI_PROMPT

export interface TtsSettings {
	enabled: boolean
	chat: boolean
	touch: boolean
	voice: string
	follow: boolean
	maxLen: number
	voices: Record<string, string>
}

export interface Settings {
	apiKey: string
	baseUrl: string
	model: string

	bubbleScale: number

	renderScale: number
	tts: TtsSettings
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
	enabled: true,
	chat: true,
	touch: true,
	voice: "gentleness",
	follow: true,
	maxLen: 80,
	voices: {},
}

export const DEFAULT_SETTINGS: Settings = {
	apiKey: "",
	baseUrl: "https://api.openai.com/v1",
	model: "",
	bubbleScale: 1,
	renderScale: 1,
	tts: {...DEFAULT_TTS_SETTINGS},
}

export interface ChatMsg {
	role: "user" | "assistant" | "system"
	content: string
	ts: number
}

interface NoriChat {
	fetchModels: (baseUrl: string, apiKey: string) => void
	chat: (baseUrl: string, apiKey: string, model: string, messagesJson: string) => void
	readFile: (name: string) => string
	writeFile: (name: string, content: string) => string
	appendMemory: (text: string) => string
	readMemory: () => string
	isStorageReady: () => boolean
	requestStoragePermission: () => void
	getStorageDir: () => string
}

declare global {
	interface Window {
		NoriChat?: NoriChat
	}
}

const bridge = (): NoriChat => {
	if (!window.NoriChat) throw new Error("NoriChat 未注入")
	return window.NoriChat
}



export const loadSettings = (): Settings => {
	try {
		const raw = bridge().readFile("settings.json")
		if (!raw) return {...DEFAULT_SETTINGS, tts: {...DEFAULT_TTS_SETTINGS, voices: {}}}
		const parsed = JSON.parse(raw)
		const merged: Settings = {...DEFAULT_SETTINGS, ...parsed, tts: {...DEFAULT_TTS_SETTINGS, ...(parsed?.tts ?? {}), voices: {...(parsed?.tts?.voices ?? {})}}}
		return merged
	} catch {
		return {...DEFAULT_SETTINGS, tts: {...DEFAULT_TTS_SETTINGS, voices: {}}}
	}
}

export const saveSettings = (s: Settings): void => {
	try {
		bridge().writeFile("settings.json", JSON.stringify(s))
	} catch {  }
}



export const loadChat = (): ChatMsg[] => {
	try {
		const raw = bridge().readFile("chat.json")
		if (!raw) return []
		const arr = JSON.parse(raw)
		if (!Array.isArray(arr)) return []
		return arr.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
	} catch {
		return []
	}
}

export const persistChat = (messages: ChatMsg[]): void => {
	try {
		bridge().writeFile("chat.json", JSON.stringify(messages))
	} catch {  }
}



export const readMemory = (): string => {
	try { return bridge().readMemory() } catch { return "" }
}

export const appendMemory = (text: string): string => {
	try { return bridge().appendMemory(text) } catch { return "err" }
}

export const readFile = (name: string): string => {
	try { return bridge().readFile(name) } catch { return "" }
}

export const writeFile = (name: string, content: string): string => {
	try { return bridge().writeFile(name, content) } catch { return "err:bridge" }
}



export const isStorageReady = (): boolean => {
	try { return !!bridge().isStorageReady() } catch { return false }
}

export const requestStoragePermission = (): void => {
	try { bridge().requestStoragePermission() } catch {  }
}

export const getStorageDir = (): string => {
	try { return bridge().getStorageDir() } catch { return "Download/DeepEr" }
}



export interface ModelsResult {
	ok: boolean
	models?: string[]
	message?: string
}


declare global {
	interface Window {
		__noriModelsRes?: (json: string) => void
		__noriChatRes?: (json: string) => void
	}
}


export const fetchModels = (baseUrl: string, apiKey: string): Promise<ModelsResult> =>
	new Promise((resolve) => {
		window.__noriModelsRes = (json) => {
			delete window.__noriModelsRes
			try { resolve(JSON.parse(json)) } catch { resolve({ok: false, message: "响应解析失败"}) }
		}
		try { bridge().fetchModels(baseUrl, apiKey) } catch { resolve({ok: false, message: "NoriChat 未注入"}) }
	})

export interface ChatResult {
	ok: boolean
	content?: string
	message?: string
}


export const sendChat = (
	baseUrl: string,
	apiKey: string,
	model: string,
	messages: ChatMsg[]
): Promise<ChatResult> => {
	if (!apiKey.trim()) return Promise.resolve({ok: false, message: "请先在设置里填写 API Key"})
	if (!model.trim()) return Promise.resolve({ok: false, message: "请先在设置里选择模型"})
	const payload = JSON.stringify(messages.map(({role, content}) => ({role, content})))
	return new Promise((resolve) => {
		window.__noriChatRes = (json) => {
			delete window.__noriChatRes
			try { resolve(JSON.parse(json)) } catch { resolve({ok: false, message: "响应解析失败"}) }
		}
		try { bridge().chat(baseUrl, apiKey, model, payload) } catch { resolve({ok: false, message: "请求失败"}) }
	})
}

