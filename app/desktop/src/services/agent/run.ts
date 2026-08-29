/**
 * Agent 循环前端入口
 *
 * LLM 多轮工具调用循环、上下文构造、工具执行、contexts 留痕全部在 Rust 侧 (agent_run 命令),
 * 前端只负责: 传用户消息 → 监听 `agent-tool-call` 事件展示执行过程 → 拿最终结果.
 */
import {invoke} from "@tauri-apps/api/core"
import {listen} from "@tauri-apps/api/event"
import {logger} from "../logger"

/**
 * Agent 循环结果 (与 Rust AgentRunOutcome camelCase 对齐)
 */
export interface AgentRunResult {
	ok: boolean
	text?: string
	error?: string
	inputTokens?: number
	outputTokens?: number
	rounds: number
	calls: number
}

/**
 * 一条用户消息 (支持多条批量发送)
 */
export interface AgentUserMessage {
	content: string
	kind?: "talk" | "touch" | "schedule"
}

/**
 * 运行 Agent 循环
 *
 * @param options    用户消息列表; 上下文由 Rust 侧从 contexts 表构造
 * @param onToolCall 每次工具调用完成后回调 (供 UI 展示执行过程)
 */
export const runAgent = async (
	options: {messages: AgentUserMessage[]},
	onToolCall?: (name: string, ok: boolean, output?: string) => void,
): Promise<AgentRunResult> => {
	const REQUEST_ID =
		(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
			? crypto.randomUUID()
			: `req_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
	const UNSUB = await listen<{requestId: string, name: string, ok: boolean, output?: string}>("agent-tool-call", event => {
		if (event.payload.requestId === REQUEST_ID) {
			onToolCall?.(event.payload.name, event.payload.ok, event.payload.output)
		}
	})
	try {
		return await invoke<AgentRunResult>("agent_run", {
			args: {
				messages: options.messages,
				requestId: REQUEST_ID,
			},
		})
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : String(error)
		await logger.error("[agent] agent_run 失败", error)
		return {ok: false, error: REASON, rounds: 0, calls: 0}
	} finally {
		UNSUB()
	}
}
