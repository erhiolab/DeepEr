import MarkdownIt from "markdown-it"

/**
 * 分割选项
 */
export interface SplitOptions {
	/**
	 * 单个 segment 的最大长度, 超过后继续按句子切分
	 */
	maxSegmentLength?: number
	/**
	 * 是否保持 fenced code block 完整
	 */
	preserveCodeBlocks?: boolean
}

// 默认选项
const DEFAULT_OPTIONS: Required<SplitOptions> = {
	maxSegmentLength: 500,
	preserveCodeBlocks: true,
}

// Markdown 解析实例 (供 block 提取)
const MD = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
})

/**
 * 把一段完整 Markdown 文本切成分段 (一次性)
 * 优先级: fenced code block 完整 > markdown block > 句子 > 最大长度兜底
 */
export const splitMarkdown = (text: string, options: SplitOptions = {}): string[] => {
	if (!text.trim()) return []
	const CONFIG = {
		...DEFAULT_OPTIONS,
		...options,
	}
	const TOKENS = MD.parse(text, {})
	const BLOCKS = extractMarkdownBlocks(text, TOKENS)
	return BLOCKS
		.flatMap((block) => splitBlock(block, CONFIG))
		.map((segment) => segment.trim())
		.filter(Boolean)
}

// 根据 markdown-it token 的 map 信息提取原始 markdown block
const extractMarkdownBlocks = (source: string, tokens: ReturnType<typeof MD.parse>): string[] => {
	const LINES = source.split("\n")
	const BLOCKS: string[] = []
	const CONSUMED_RANGES: Array<[number, number]> = []
	for (const TOKEN of tokens) {
		if (!TOKEN.map) continue
		// 只处理真正的 block token
		if (!isBlockStartToken(TOKEN.type)) continue
		const [start, end] = TOKEN.map
		if (start >= end) continue
		// 防止 paragraph_open / inline / paragraph_close 等重复提取同一区域
		const ALREADY_CONSUMED = CONSUMED_RANGES.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd)
		if (ALREADY_CONSUMED) continue
		const BLOCK = LINES
			.slice(start, end)
			.join("\n")
			.trim()
		if (!BLOCK) continue
		CONSUMED_RANGES.push([start, end])
		BLOCKS.push(BLOCK)
	}
	// parse 没有产生可用 block 时兜底
	return BLOCKS.length > 0 ? BLOCKS : [source]
}

// 判断哪些 token 可以作为 markdown block 的起点
const isBlockStartToken = (type: string): boolean => {
	return [
		"fence",
		"code_block",
		"paragraph_open",
		"heading_open",
		"blockquote_open",
		"bullet_list_open",
		"ordered_list_open",
		"table_open",
		"hr",
	].includes(type)
}

// 分割单个 markdown block
const splitBlock = (block: string, options: Required<SplitOptions>): string[] => {
	if (!block.trim()) return []
	// fenced code block 完整保留
	if (options.preserveCodeBlocks && isFencedCodeBlock(block)) return [block]
	// 含 markdown 结构/行内元素: 整块保持完整, 不做句子切分 (避免切碎标题/列表/引用/粗体等语法)
	if (containsMarkdown(block)) return [block]
	// 纯文本普通段落: 一律按句子切分; 单个句子超长时兜底硬切
	return splitIntoSentences(block).flatMap((sentence) =>
		sentence.length > options.maxSegmentLength
			? splitByLength(sentence, options.maxSegmentLength)
			: [sentence],
	)
}

/**
 * 判断是否为完整 fenced code block
 * @param text 要判断的文本
 * @returns 是否为完整 fenced code block
 */
export const isFencedCodeBlock = (text: string): boolean => {
	const TRIMMED = text.trim()
	return (
		/^(```|~~~)/.test(TRIMMED) &&
		/(```|~~~)\s*$/.test(TRIMMED)
	)
}

// markdown 块级 / 行内语法特征 (命中则整块保持完整, 不按句子切分, 避免切碎 md 结构)
const MD_PATTERNS: RegExp[] = [
	/^\s{0,3}#{1,6}\s/m, // atx 标题
	/^\s{0,3}(`{3,}|~{3,})/m, // fenced code 兜底
	/^\s{0,3}>/m, // 引用块
	/^\s{0,3}([-*+]|\d{1,9}\.)\s/m, // 无序 / 有序列表
	/^\s{0,3}([-_*])(\s*\1){2,}\s*$/m, // horizontal rule
	/^\s{0,3}[-*+]\s*\[[ xX]\]/, // task list
	/\*\*[^*\n]+?\*\*/, // 粗体
	/__[^_\n]+?__/, // 粗体 (下划线)
	/\*[^*\n]+\*/, // 斜体
	/_[^_\n]+_/, // 斜体 (下划线)
	/~~[^~\n]+~~/, // 删除线
	/`{1,3}/, // 行内代码
	/!?\[[^\]]*\]\([^)\n]*\)/, // 链接 / 图片
	/(?:https?|ftp):\/\/\S+|\bwww\.\S+/i, // 裸链接
	/^\s{0,3}<[a-zA-Z][^>\n]*>/, // html 标签行
]

/**
 * 检测文本是否包含 markdown 结构/行内元素
 * 命中则整体返回 (不分句), 以免切碎标题/列表/引用/粗体/行内代码等语法
 */
const containsMarkdown = (text: string): boolean => MD_PATTERNS.some((pattern) => pattern.test(text))

// 超长内容的最后兜底切分, 优先: 换行 > 空白符 > 字符
const splitByLength = (text: string, maxLength: number): string[] => {
	const RESULT: string[] = []
	let remaining = text.trim()
	while (remaining.length > maxLength) {
		let splitIndex = findBestSplitIndex(remaining, maxLength)
		if (splitIndex <= 0) {
			splitIndex = maxLength
		}
		RESULT.push(remaining.slice(0, splitIndex).trim())
		remaining = remaining.slice(splitIndex).trimStart()
	}
	if (remaining) RESULT.push(remaining)
	return RESULT
}

// 查找最佳切分索引, 优先: 换行 > 空白符 > 字符
const findBestSplitIndex = (text: string, maxLength: number): number => {
	const SEARCH_START = Math.max(0, maxLength - 100)
	for (let i = maxLength; i >= SEARCH_START; i--) {
		if (text[i] === "\n") return i + 1
	}
	for (let i = maxLength; i >= SEARCH_START; i--) {
		if (/\s/.test(text[i])) return i + 1
	}
	return maxLength
}

/**
 * 句子分割
 * - 中文：。！？；
 * - 英文：.!?;
 * - 连续标点：!!!、...、？！等
 * - 行内代码：`foo.bar()`
 * - markdown link
 */
export const splitIntoSentences = (text: string): string[] => {
	const RESULT: string[] = []
	let current = ""
	let inlineCodeDelimiter = ""
	let inlineCodeLength = 0
	const pushCurrent = () => {
		const VALUE = current.trim()
		if (VALUE) {
			RESULT.push(VALUE)
		}
		current = ""
	}
	for (let i = 0; i < text.length; i++) {
		const CHAR = text[i]
		// 行内代码: markdown 允许多个连续反引号 (`` code ` inside ``)
		if (CHAR === "`") {
			const COUNT = countRepeated(text, i, "`")
			if (!inlineCodeDelimiter) {
				inlineCodeDelimiter = "`".repeat(COUNT)
				inlineCodeLength = COUNT
				current += inlineCodeDelimiter
				i += COUNT - 1
				continue
			}
			if (COUNT === inlineCodeLength) {
				current += inlineCodeDelimiter
				i += COUNT - 1
				inlineCodeDelimiter = ""
				inlineCodeLength = 0
				continue
			}
		}
		current += CHAR
		// 行内代码内部不切分
		if (inlineCodeDelimiter) continue
		if (!isSentenceEnd(CHAR)) continue
		// 连续结束标点全部吃掉
		while (i + 1 < text.length && isSentenceEnd(text[i + 1])) {
			i++
			current += text[i]
		}
		pushCurrent()
	}
	pushCurrent()
	return RESULT
}

// 统计连续字符出现的次数
const countRepeated = (text: string, start: number, char: string): number => {
	let count = 0
	for (let i = start; i < text.length && text[i] === char; i++) count++
	return count
}

// 判断是否为句子结束字符
const isSentenceEnd = (char: string): boolean => {
	return [
		".",
		"!",
		"?",
		";",
		"。",
		"！",
		"？",
		"；",
	].includes(char)
}

/**
 * 创建流式 markdown 分割器 (闭包 factory, 不使用 class)
 * - buffer: 尚未确认完成的内容
 * - completed: 已经完成的 segment
 */
export const createStreamingMarkdownSplitter = (options: SplitOptions = {}) => {
	const CONFIG = {
		...DEFAULT_OPTIONS,
		...options,
	}
	let buffer = ""
	let completed: string[] = []

	/**
	 * 判断 buffer 是否存在未闭合 fenced code block
	 */
	const hasUnclosedFence = (text: string): boolean => {
		const LINES = text.split("\n")
		let fenceMarker = ""
		for (const LINE of LINES) {
			const MATCH = LINE.match(/^(\s*)(`{3,}|~{3,})/)
			if (!MATCH) continue
			const MARKER = MATCH[2]
			const MARKER_CHAR = MARKER[0]
			const MARKER_LENGTH = MARKER.length
			if (!fenceMarker) {
				fenceMarker = MARKER
				continue
			}
			const OPENING_CHAR = fenceMarker[0]
			const OPENING_LENGTH = fenceMarker.length
			if (MARKER_CHAR === OPENING_CHAR && MARKER_LENGTH >= OPENING_LENGTH) {
				fenceMarker = ""
			}
		}
		return Boolean(fenceMarker)
	}

	/**
	 * 消费一段增量, 输出已确认完成的 segment
	 * 最后一个 segment 始终留在 buffer, 防止后续继续追加.
	 */
	const consume = (chunk: string): { completed: string[]; rest: string } => {
		if (!chunk) {
			return {
				completed: [],
				rest: buffer,
			}
		}
		buffer += chunk
		// 代码块尚未结束, 绝不提前输出
		if (CONFIG.preserveCodeBlocks && hasUnclosedFence(buffer)) {
			return {
				completed: [],
				rest: buffer,
			}
		}
		const SEGMENTS = splitMarkdown(buffer, CONFIG)
		// 没有明确的分割点时继续缓存
		if (SEGMENTS.length <= 1) {
			return {
				completed: [],
				rest: buffer,
			}
		}
		// 最后一段可能仍不完整, 保留
		const SAFE_SEGMENTS = SEGMENTS.slice(0, -1)
		const REST = SEGMENTS[SEGMENTS.length - 1] ?? ""
		completed.push(...SAFE_SEGMENTS)
		buffer = REST
		return {
			completed: SAFE_SEGMENTS,
			rest: buffer,
		}
	}

	/**
	 * 强制输出剩余内容
	 */
	const flush = (): string[] => {
		if (buffer.trim()) {
			completed.push(...splitMarkdown(buffer, CONFIG))
		}
		buffer = ""
		return [...completed]
	}

	/**
	 * 获取当前未完成内容
	 */
	const getRest = (): string => buffer

	/**
	 * 获取所有已完成内容
	 */
	const getCompleted = (): string[] => [...completed]

	/**
	 * 重置状态
	 */
	const reset = (): void => {
		buffer = ""
		completed = []
	}

	return {
		consume,
		flush,
		reset,
		getRest,
		getCompleted,
	}
}
