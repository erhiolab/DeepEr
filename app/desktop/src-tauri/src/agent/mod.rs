//! Agent 运行时模块
//!
//! LLM 多轮工具调用循环整体在 Rust 侧:
//! - [`prompt`] : 工具协议系统提示词 (内置清单来自 tools 表)
//! - [`parser`] : 解析 LLM 回复里的 <tool_call> 标签
//! - [`run`]    : 循环编排 (LLM 生成 → 工具执行 → <tool_result> 回填) + contexts 留痕
//! - [`context`]: 上下文构造 (人设 + 历史, token 预算裁剪, 命中率)

pub mod context;
pub mod parser;
pub mod prompt;
pub mod run;
