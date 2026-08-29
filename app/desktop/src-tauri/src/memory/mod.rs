//! 长期记忆模块
//!
//! 参考 docs/记忆.md: 记忆是值得长期保留的信息, 与对话上下文分开存储.
//! - [`model`]     : MemoryRecord / MemoryInput
//! - [`repository`]: memories + memory_tags 表增删改查
//! - [`recall`]    : 回忆打分 (关键词 + 重要性 + 置信度 + 新鲜度 + 强化)

pub mod model;
pub mod recall;
pub mod repository;
