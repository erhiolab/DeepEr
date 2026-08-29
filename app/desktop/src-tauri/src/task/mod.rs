//! 定时任务模块
//!
//! - [`model`]      : TaskRecord (tasks 表定义)
//! - [`repository`] : tasks 表增删改查
//! - [`next`]       : 根据 schedule(JSON 数组)计算下一次执行时刻
//! - [`scheduler`]  : 后台调度线程 (启动即初始化, 每秒检查, 到点 emit 事件)

pub mod model;
pub mod next;
pub mod repository;
pub mod scheduler;
