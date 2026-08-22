/**
 * TTS 适配器通用类型
 *
 * 架构: 适配器模式 + 统一协议.
 * - 每个平台实现一个 `TTSAdapter` (自己的协议逻辑), 注册进 `adapters.ts`.
 * - 软件对外 (页面 / 将来的 AI 调用) 只走 `useTTSStore` 的统一入口
 *   `synthesize(req) -> TtsSynthesizeResult`, 由 store 按当前激活适配器路由.
 * - 同一时间仅激活一个适配器, 激活状态存 `tts_adapter` 配置键.
 */

/**
 * 适配器唯一标识
 */
export type TTSAdapterId = "gpt-sovits"

/**
 * 一条参考音频 (GPT-SoVITS 的「情绪」条目, 由人工逐条筛选配置)
 */
export interface TTSVoiceEntry {
	/**
	 * 情感名称 (必须唯一)
	 */
	name: string
	/**
	 * 参考音频路径 (对应 GPT-SoVITS 的 ref_audio_path)
	 */
	audioPath: string
	/**
	 * 参考音频的文字内容 (对应 GPT-SoVITS 的 prompt_text)
	 */
	promptText: string
	/**
	 * 参考音频的语言 (对应 GPT-SoVITS 的 prompt_lang, 每条参考音频独立)
	 */
	promptLang: string
}

/**
 * 统一合成请求: AI / 对话 / 页面 都传这个, 由软件按激活适配器翻译成平台协议.
 */
export interface TtsSynthesizeRequest {
	/**
	 * 要合成的文本 (必填)
	 */
	text: string
	/**
	 * 音色/情感名 (可选, 缺省时由适配器使用默认音色)
	 */
	voice?: string
	/**
	 * 合成文本语言 (可选, 缺省用适配器配置)
	 */
	language?: string
	/**
	 * 语速倍率 (可选, 缺省用适配器配置)
	 */
	speed?: number
}

/**
 * 统一合成结果: 不管底层是哪个平台, 返回给软件的都是这个协议.
 */
export interface TtsSynthesizeResult {
	/**
	 * 是否成功
	 */
	ok: boolean
	/**
	 * 成功时: 可播放的 asset 相对路径 (如 `_tts/xxx.wav`)
	 */
	audioAssetPath?: string
	/**
	 * 成功时: 产物文件名
	 */
	fileName?: string
	/**
	 * 失败时: 人类可读错误 (尽量透传平台返回的具体原因)
	 */
	error?: string
}

/**
 * 统一连接测试结果 (结构化, 文案由调用方/UI 组装)
 */
export interface TtsTestResult {
	/**
	 * 是否连通
	 */
	ok: boolean
	/**
	 * 有 HTTP 响应时的状态码 (任意响应都证明服务在线)
	 */
	status?: number
	/**
	 * 网络层失败原因 (连接被拒/超时等)
	 */
	error?: string
}

/**
 * 音色信息: 供上层枚举该适配器当前可用的音色 (AI 调用前可选)
 */
export interface TTSVoiceInfo {
	/**
	 * 音色/情感名
	 */
	name: string
	/**
	 * 描述 (如参考音频路径)
	 */
	description?: string
}

/**
 * 适配器实现: 每个平台一份, 封装自己的协议 (配置 / 请求 / 解析).
 * 新增适配器 = 实现本接口 + 注册进 `adapters.ts` + 自备一个配置面板组件.
 */
export interface TTSAdapter<TConfig = unknown> {
	/**
	 * 唯一标识
	 */
	readonly id: TTSAdapterId
	/**
	 * 展示名称
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
	testConnection(): Promise<TtsTestResult>
	/**
	 * 合成 (按当前配置 + 请求参数调用平台协议)
	 */
	synthesize(request: TtsSynthesizeRequest): Promise<TtsSynthesizeResult>
	/**
	 * 枚举当前可用音色 (可选能力)
	 */
	listVoices?(): Promise<TTSVoiceInfo[]>
}
