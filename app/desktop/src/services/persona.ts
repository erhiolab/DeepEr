/**
 * 人设服务层
 *
 * 封装人设 (角色卡) 相关 Tauri 命令调用:
 * 列表 / 创建 / 更新 / 删除 / 选中 / 导入 SillyTavern 角色卡
 * 选中的人设 id 由后端写入 config 表 `selected_persona_id`
 */
import {invoke} from "@tauri-apps/api/core"
import {assetUrlSafe} from "./asset"
import {logger} from "./logger"

/** 人设记录 (与后端 PersonaRecord camelCase 对齐) */
export interface Persona {
	id: number
	name: string
	description: string
	personality: string
	scenario: string
	firstMes: string
	mesExample: string
	systemPrompt: string
	postHistoryInstructions: string
	avatarPath: string | null
	source: string
	createdAt: number
	updatedAt: number
}

/** 人设写入参数 */
export interface PersonaInput {
	name: string
	description: string
	personality: string
	scenario: string
	firstMes: string
	mesExample: string
	systemPrompt: string
	postHistoryInstructions: string
}

/** 空人设草稿 */
export const emptyPersonaInput = (): PersonaInput => ({
	name: "",
	description: "",
	personality: "",
	scenario: "",
	firstMes: "",
	mesExample: "",
	systemPrompt: "",
	postHistoryInstructions: "",
})

/** 人设来源: 手动创建 */
export const PERSONA_SOURCE_MANUAL = "manual"
/** 人设来源: SillyTavern 角色卡导入 */
export const PERSONA_SOURCE_SILLYTAVERN = "sillytavern"

/** 获取人设列表 (按创建顺序) */
export const listPersonas = async (): Promise<Persona[]> => {
	try {
		return await invoke<Persona[]>("persona_list")
	} catch (error) {
		await logger.error("获取人设列表失败", error)
		return []
	}
}

/** 获取单个人设 */
export const getPersona = async (id: number): Promise<Persona | null> => {
	try {
		return await invoke<Persona>("persona_get", {id})
	} catch (error) {
		await logger.error(`获取人设 ${id} 失败`, error)
		return null
	}
}

/** 创建人设 */
export const createPersona = async (input: PersonaInput): Promise<Persona | null> => {
	try {
		return await invoke<Persona>("persona_create", {args: input})
	} catch (error) {
		await logger.error("创建人设失败", error)
		return null
	}
}

/** 更新人设 */
export const updatePersona = async (id: number, input: PersonaInput): Promise<Persona | null> => {
	try {
		return await invoke<Persona>("persona_update", {id, args: input})
	} catch (error) {
		await logger.error(`更新人设 ${id} 失败`, error)
		return null
	}
}

/** 删除人设, 返回是否成功 */
export const deletePersona = async (id: number): Promise<boolean> => {
	try {
		await invoke("persona_delete", {id})
		return true
	} catch (error) {
		await logger.error(`删除人设 ${id} 失败`, error)
		return false
	}
}

/** 设置 / 清除当前选中人设 (null = 清除选择), 返回是否成功 */
export const selectPersona = async (id: number | null): Promise<boolean> => {
	try {
		await invoke("persona_select", {id})
		return true
	} catch (error) {
		await logger.error("设置选中人设失败", error)
		return false
	}
}

/** 读取当前选中的人设 id */
export const getSelectedPersonaId = async (): Promise<number | null> => {
	try {
		const RAW = await invoke<unknown>("get_config", {key: "selected_persona_id"})
		if (typeof RAW === "number") return RAW
		if (typeof RAW === "string") {
			const PARSED = Number(RAW)
			return Number.isFinite(PARSED) ? PARSED : null
		}
		return null
	} catch (error) {
		await logger.error("读取选中人设失败", error)
		return null
	}
}

/** 导入结果 */
export interface ImportPersonaResult {
	ok: boolean
	persona: Persona | null
	error: string | null
}

/** 导入 SillyTavern 角色卡文件 (.json / .png) */
export const importPersonaFile = async (path: string): Promise<ImportPersonaResult> => {
	try {
		const PERSONA = await invoke<Persona>("persona_import_file", {path})
		return {ok: true, persona: PERSONA, error: null}
	} catch (error) {
		await logger.error(`导入角色卡失败: ${path}`, error)
		return {ok: false, persona: null, error: String(error)}
	}
}

/** 人设头像 asset URL (非法路径返回 null) */
export const personaAvatarUrl = (persona: Persona): string | null => {
	if (!persona.avatarPath) return null
	return assetUrlSafe(persona.avatarPath)
}

/**
 * 把人设拼成 system 消息 (只包含非空字段, 供对话系统注入 LLM 上下文)
 */
export const buildPersonaSystemMessage = (persona: Persona): string => {
	const SECTIONS: {title: string; content: string}[] = [
		{title: "描述", content: persona.description},
		{title: "性格", content: persona.personality},
		{title: "场景", content: persona.scenario},
		{title: "开场白", content: persona.firstMes},
		{title: "对话示例", content: persona.mesExample},
		{title: "系统指令", content: persona.systemPrompt},
		{title: "后续指令", content: persona.postHistoryInstructions},
	]
	const LINES: string[] = [`你是「${persona.name}」。`]
	for (const section of SECTIONS) {
		const CONTENT = section.content.trim()
		if (CONTENT) LINES.push(`【${section.title}】\n${CONTENT}`)
	}
	return LINES.join("\n\n")
}
