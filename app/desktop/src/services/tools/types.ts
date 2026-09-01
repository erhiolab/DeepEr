/**
 * 工具注册机类型定义
 *
 * 每个工具都有:
 * - `name`  : 英文调用名 (Agent 调用时使用), 如 `tool-search`
 * - `label` : 中文标题 (界面展示), 如 `工具-搜索工具`
 * 工具定义存放在后端 `tools` 表 (Definition Registry), 执行在 Rust 侧
 * (ToolService + RuntimeRegistry), 前端只做渲染与 Agent 循环编排.
 */

/**
 * 一条工具记录
 */
export interface ToolDefinition {
	/**
	 * 唯一 id
	 */
	id: number
	/**
	 * 英文调用名 (Agent 调用时使用)
	 */
	name: string
	/**
	 * 中文标题 (界面展示)
	 */
	label: string
	/**
	 * 工具描述: 说明用途 / 参数 / 调用方式
	 */
	description: string
	/**
	 * 搜索别名: AI 搜索工具时的额外关键词 (前端可编辑, 每行一个)
	 */
	keywords: string[]
	/**
	 * 是否内置工具
	 */
	builtin: boolean
	/**
	 * Provider 类型: internal / http / mcp / plugin
	 */
	provider: string
	/**
	 * Provider 内部的执行目标 (internal 时即 Handler 名)
	 */
	executor: string
	/**
	 * JSON Schema (入参校验)
	 */
	inputSchema: Record<string, unknown>
	/**
	 * Provider 专属配置
	 */
	config: Record<string, unknown>
	/**
	 * 是否启用
	 */
	enabled: boolean
	/**
	 * 工具版本
	 */
	version: string
	/**
	 * 注册时间 (Unix 秒)
	 */
	createdAt: number
	/**
	 * 更新时间 (Unix 秒)
	 */
	updatedAt: number
}
