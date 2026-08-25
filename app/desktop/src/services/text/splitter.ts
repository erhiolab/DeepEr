/**
 * 文本分词器
 *
 * 从对话状态的流动缓冲/展示逻辑中分离: 负责把文本按规则切成若干段 (气泡).
 * 供流式缓冲 (`consumeCompleted`) 与界面分段展示 (`splitSentences`) 复用.
 *
 * 分段规则 (优先级):
 *  1. 代码块 ``` 与行内代码 ` 包裹内容内部不做分句 (md 兼容, 代码的标点/换行不切);
 *  2. 换行 / 空行: 强分隔, 遇换行立即提交当前段 (连续换行与 \r\n 不产生空段);
 *  3. 句子结束标点: 弱分隔, 遇标点提交该句;
 *  4. 引号包裹的内容内部不做分句 (避免把 "..." 里的标点切出, 导致引号丢失).
 */

/**
 * 句子结束标点
 * 连续结束标点 (如省略号/双感叹号) 视为同句整体, 不拆开.
 * 使用 Unicode 转义定义中日韩/全角标点, 避免源文件编码被破坏.
 */
const SENTENCE_ENDS: ReadonlySet<string> = new Set([
	"\u3002", // 中文句号 。  
	"\uFF01", // 全角感叹号 ！  
	"\uFF1F", // 全角问号 ？  
	"\uFF1B", // 全角分号 ；  
	"\u2026", // 省略号 … 
	"!",
	"?",
	".",
	";",
	"\n",
])

/**
 * 左引号 (进入引号状态), 用 Unicode 转义表示中文弯引号
 */
const QUOTE_OPEN: ReadonlySet<string> = new Set(['"', "\u201C" /* “ */, "\u2018" /* ‘ */])

/**
 * @param quoteChar 当前所在左引号字符
 * @param ch 待判定字符
 * @returns 是否 ch 是 quoteChar 的匹配右引号
 */
const isQuoteCloser = (quoteChar: string, ch: string): boolean => {
	if (quoteChar === '"') return ch === '"'
	if (quoteChar === "\u201C") return ch === "\u201D"
	if (quoteChar === "\u2018") return ch === "\u2019"
	return false
}

/**
 * 从流式缓冲中切出已完成的句子, 返回已完成的段与剩余未完成的尾巴 (rest)
 */
export const consumeCompleted = (text: string): {done: string[], rest: string} => {
	const done: string[] = []
	let restStart = 0
	let inQuote = false
	let quoteChar: string | null = null
	let inCode = false // 行内代码 `...`
	let inCodeBlock = false // 代码块 ```...```
	// 当前位置起是否为三反引号 (代码块开/闭)
	const AT_TRIPLE = (i: number): boolean => text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`"
	for (let i = 0; i < text.length; i++) {
		const CH = text[i]
		// 代码块内部: 全部字符不参与分句 (含换行), 直到三反引号闭合
		if (inCodeBlock) {
			if (AT_TRIPLE(i)) {
				inCodeBlock = false
				i += 2
			}
			continue
		}
		// 行内代码内部: 不参与分句, 直到单个反引号闭合
		if (inCode) {
			if (CH === "`" && !AT_TRIPLE(i)) {
				inCode = false
			}
			continue
		}
		// 进入代码块 (三反引号), 可带语言标记 (```js)
		if (AT_TRIPLE(i)) {
			inCodeBlock = true
			i += 2
			continue
		}
		// 进入行内代码 (单个反引号)
		if (CH === "`" && !AT_TRIPLE(i)) {
			inCode = true
			continue
		}
		// 引号状态控制: 引号内部不参与分句
		if (!inQuote && QUOTE_OPEN.has(CH)) {
			inQuote = true
			quoteChar = CH
			continue
		}
		if (inQuote) {
			if (quoteChar !== null && isQuoteCloser(quoteChar, CH)) {
				inQuote = false
				quoteChar = null
			}
			continue
		}
		// 强分隔: 换行 / 空行 (含 \r\n), 立即提交当前段
		if (CH === "\n") {
			const SEG = text.slice(restStart, i).trimEnd()
			if (SEG) done.push(SEG)
			// 跳过连续的换行与回车 (空行不产生空段)
			let j = i
			while (j + 1 < text.length && (text[j + 1] === "\n" || text[j + 1] === "\r")) j++
			restStart = j + 1
			i = j
			continue
		}
		if (!SENTENCE_ENDS.has(CH)) continue
		// 弱分隔: 句子结束标点, 连续结束标点视为同一句结尾 (但不并入换行)
		let j = i
		while (j + 1 < text.length && SENTENCE_ENDS.has(text[j + 1]) && text[j + 1] !== "\n") j++
		done.push(text.slice(restStart, j + 1))
		restStart = j + 1
		i = j
	}
	return {done, rest: text.slice(restStart)}
}
