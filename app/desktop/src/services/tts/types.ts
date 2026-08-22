/**
 * TTS 适配器通用类型
 *
 * 设计目标: 适配器模式——多平台可插拔, 但同一时间只允许激活一个.
 * 新增适配器时只需在 `adapters.ts` 注册一个 Definition 并自备配置面板,
 * 无需改动核心页面与后端命令.
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
 * 适配器定义: 用于在注册表中展示/路由
 */
export interface TTSAdapterDefinition {
	/**
	 * 唯一标识
	 */
	id: TTSAdapterId
	/**
	 * 展示名称
	 */
	label: string
	/**
	 * 一句话描述
	 */
	description: string
}
