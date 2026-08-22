/**
 * LLM 适配器通用类型
 *
 * 架构 (与 TTS 一致): 适配器模式 + 统一协议.
 * - 每个平台(OpenAI Responses / Anthropic Messages / Google GenAI)实现一个 `LLMAdapter`,
 *   各自封装自己的对外协议(请求体、鉴权头、响应解析), 注册进 `adapters.ts`.
 * - 软件对外(对话页面 / 将来的 AI Agent 调用)只走 `useLLMStore` 的统一入口,
 *   由 store 按当前激活适配器路由到对应平台的实现.
 * - 同一时间仅激活一个适配器, 激活状态存 `llm_adapter` 配置键 (存 `none` 表示不启用).
 *
 * 说明: 用户配置的是「平台 + 该平台的 API Base / Key / 模型」, 软件内部维护这一套
 * 状态协议, 请求时再翻译成各平台自己的 wire protocol.
 */

/**
 * 适配器唯一标识
 */
export type LLMAdapterId = "openai-responses" | "anthropic-messages" | "google-genai"

/**
 * LLM 对话角色 (软件统一协议)
 */
export type LLMRole = "system" | "user" | "assistant"

/**
 * 统一对话消息 (软件内部的状态协议)
 */
export interface LLMMessage {
	role: LLMRole
	content: string
}

/**
 * 统一生成请求: 对话 / Agent 都传这个, 由软件按激活适配器翻译成平台协议.
 */
export interface LLMGenerateRequest {
	/**
	 * 对话历史 (含 system 角色可作为人设)
	 */
	messages: LLMMessage[]
	/**
	 * 手动指定模型名 (可选, 缺省用适配器已保存的配置)
	 */
	model?: string
	/**
	 * 温度 (可选, 缺省用适配器配置)
	 */
	temperature?: number
	/**
	 * 最大输出 token 数 (可选, 缺省用适配器配置上限)
	 */
	maxTokens?: number
}

/**
 * 统一生成结果: 不管底层是哪个平台, 返回给软件的都是这个协议.
 */
export interface LLMGenerateResult {
	ok: boolean
	/**
	 * 成功时: 平台返回的完整文本
	 */
	text?: string
	/**
	 * 成功时: 本次实际消耗的输入/输出 token (可选)
	 */
	inputTokens?: number
	outputTokens?: number
	/**
	 * 失败时: 人类可读错误 (尽量透传平台返回的具体原因)
	 */
	error?: string
}

/**
 * 统一连接测试结果 (结构化, 文案由调用方/UI 组装)
 */
export interface LLMTestResult {
	ok: boolean
	/**
	 * 有 HTTP 响应时的状态码 (任意 2xx 视为成功)
	 */
	status?: number
	/**
	 * 失败原因 (网络层失败, 或未配置完整而无法发起请求)
	 */
	error?: string
}

/**
 * 统一模型信息: 供上层枚举该适配器当前可用的模型
 */
export interface LLMModelInfo {
	id: string
	label?: string
}

/**
 * 适配器实现: 每个平台一份, 封装自己的协议(配置 / 请求 / 解析).
 * 新增适配器 = 实现本接口 + 注册进 `adapters.ts` + 自备一个配置面板组件.
 */
export interface LLMAdapter<TConfig = unknown> {
	/**
	 * 唯一标识
	 */
	readonly id: LLMAdapterId
	/**
	 * 展示名称 (市场协议名)
	 */
	readonly label: string
	/**
	 * 一句话描述
	 */
	readonly description: string
	/**
	 * 读取该适配器配置 (每次调用前读取, 保证用最新配置)
	 */
	loadConfig(): Promise<TConfig>
	/**
	 * 保存该适配器配置
	 */
	saveConfig(config: TConfig): Promise<void>
	/**
	 * 连接测试 (按当前配置请求平台, 返回结构化结果)
	 */
	testConnection(): Promise<LLMTestResult>
	/**
	 * 获取该适配器当前可用的模型列表 (按已保存配置请求平台).
	 * 有模型列表 API 的平台实时拉取, 无 API 的平台 (如 Anthropic) 返回内置预设.
	 * 返回空数组表示暂时拿不到, 前端应保留手动填写.
	 */
	listModels(): Promise<LLMModelInfo[]>
	/**
	 * 是否已配置 (保存) 过 API Key
	 */
	hasApiKey?(): Promise<boolean>
	/**
	 * 清除已保存的 API Key
	 */
	clearApiKey?(): Promise<void>
	/**
	 * 生成 (按当前配置 + 请求参数调用平台协议)
	 */
	generate(request: LLMGenerateRequest): Promise<LLMGenerateResult>
}
