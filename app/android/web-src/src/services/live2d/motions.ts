import {live2dUrl} from "./config"
import type {MotionGroup} from "./index"

// entryBase 为入口文件基础名 (如 "Haru"), 对应 <entryBase>.model3.json
const readModel3 = async (modelId: string, entryBase: string): Promise<any | null> => {
	try {
		const resp = await fetch(`${live2dUrl(`${modelId}/${entryBase}/${entryBase}.model3.json`)}`)
		if (!resp.ok) return null
		return await resp.json()
	} catch { return null }
}

export const readMotionGroups = async (modelId: string, entryBase: string): Promise<MotionGroup[] | null> => {
	const model = await readModel3(modelId, entryBase)
	const motions = model?.FileReferences?.Motions
	if (!motions || typeof motions !== "object") return null
	const groups: MotionGroup[] = []
	for (const [group, items] of Object.entries(motions)) {
		if (!Array.isArray(items)) continue
		const names = items
			.map((it: any) => it?.File)
			.filter((f): f is string => typeof f === "string")
			.map((f) => f.replace(/\.motion3\.json$/i, "").replace(/^.*\//, ""))
			.filter((n) => n !== "")
		if (names.length) groups.push({group, names})
	}
	return groups.length ? groups : null
}

export const readExpressionNames = async (modelId: string, entryBase: string): Promise<string[]> => {
	const model = await readModel3(modelId, entryBase)
	const refs = model?.FileReferences?.Expressions
	if (!Array.isArray(refs)) return []
	return refs.map((it: any) => it?.Name).filter((n): n is string => typeof n === "string" && n !== "")
}
