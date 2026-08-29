import {loadSettings} from "../chat"

interface NoriTTS {
	init: () => void
	ready: () => boolean
	status: () => string
	emotions: () => string
	synthesize: (text: string, emotion: string) => number
	play: (id: number) => void
	stop: () => void
}

export interface TtsStatus {
	state: "absent" | "unavailable" | "copying" | "ready"
	message: string
}

declare global {
	interface Window {
		NoriTTS?: NoriTTS
		__noriTTSRes?: (json: string) => void
	}
}

const bridge = (): NoriTTS => {
	if (!window.NoriTTS) throw new Error("NoriTTS 未注入")
	return window.NoriTTS
}

const waiters = new Map<number, (ok: boolean) => void>()
let engineReady = false
let lastInitMessage = ""
const engineWaiters: ((ok: boolean) => void)[] = []

window.__noriTTSRes = (json) => {
	let ev: {event: string; id?: number; ok?: boolean; message?: string}
	try { ev = JSON.parse(json) } catch { return }
	if (ev.event === "init") {
		if (ev.message) lastInitMessage = ev.message
		return
	}
	if (ev.event === "init-done") {
		engineReady = !!ev.ok
		if (ev.message) lastInitMessage = ev.message
		while (engineWaiters.length) engineWaiters.shift()!(engineReady)
		return
	}
	if (ev.event === "error" && typeof ev.id === "number") {
		const w = waiters.get(ev.id)
		if (w) { waiters.delete(ev.id); w(false) }
		return
	}
	if (typeof ev.id === "number" && (ev.event === "ready" || ev.event === "done")) {
		const w = waiters.get(ev.id)
		if (w) { waiters.delete(ev.id); w(true) }
	}
}

export const ttsInit = (): Promise<boolean> =>
	new Promise((resolve) => {
		if (!window.NoriTTS) return resolve(false)
		if (engineReady) return resolve(true)
		engineWaiters.push(resolve)
		try { bridge().init() } catch { resolve(false) }
	})

export const ttsReady = (): boolean => engineReady

export const ttsStatus = (): TtsStatus => {
	if (!window.NoriTTS) return {state: "absent", message: "未在 APP 内运行，语音不可用"}
	try {
		const s = JSON.parse(bridge().status()) as {state?: string; message?: string}
		return {state: (s.state as TtsStatus["state"]) ?? "unavailable", message: s.message ?? ""}
	} catch {
		return {state: "unavailable", message: lastInitMessage}
	}
}

export const ttsEmotions = (): string[] => {
	if (!window.NoriTTS) return []
	try {
		const arr = JSON.parse(bridge().emotions())
		return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []
	} catch { return [] }
}

export const ttsReinit = (): Promise<boolean> => {
	engineReady = false
	return ttsInit()
}

export const ttsSynthesize = (text: string, emotion = "gentleness"): Promise<number | null> =>
	new Promise((resolve) => {
		if (!window.NoriTTS || !engineReady) return resolve(null)
		try {
			const id = bridge().synthesize(text, emotion)
			waiters.set(id, (ok) => { waiters.delete(id); resolve(ok ? id : null) })
		} catch { resolve(null) }
	})

export const ttsPlay = (id: number): Promise<void> =>
	new Promise((resolve) => {
		if (!window.NoriTTS) return resolve()
		waiters.set(id, () => { waiters.delete(id); resolve() })
		try { bridge().play(id) } catch { resolve() }
	})

export const ttsStop = (): void => {
	try {
		waiters.forEach((w) => w(false))
		waiters.clear()
		bridge().stop()
	} catch { }
}

export const currentSettings = loadSettings
