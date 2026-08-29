//! 定时任务调度线程
//!
//! 软件启动即初始化: 每秒检查一次已启用任务, 到点 emit `scheduled-task-due` 事件给前端,
//! 前端收到后通过消息队列把任务内容发给 AI. 一次性任务触发后自动删除.
//!
//! 循环任务靠内存中的 last_fired 表防重复触发:
//! - 启动时默认 last_fired = 启动时刻, 错过的时间不补 (重启后不会疯狂补发)
//! - 同一会话内新建/修改/启用任务会把 last_fired 重置为当前时刻, 避免触发"过去的"时间

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::db;
use crate::log::{self, LogSource};
use crate::task::model::TaskRecord;
use crate::task::{next, repository};

/// 到点事件名 (前端按此监听)
pub const SCHEDULED_TASK_EVENT: &str = "scheduled-task-due";

/// 记忆清理周期 (tick 数, 每秒一次 → 约 1 小时)
const MEMORY_CLEANUP_INTERVAL: usize = 3600;
/// 清理计数器
static CLEANUP_TICK: AtomicUsize = AtomicUsize::new(0);

/// 调度器共享状态: task_id → 上次触发时刻
pub struct SchedulerState(pub Arc<Mutex<HashMap<i64, i64>>>);

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 初始化: 管理共享状态 + 启动后台调度线程
pub fn init(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
	app.manage(SchedulerState(Arc::new(Mutex::new(HashMap::new()))));
	let handle = app.clone();
	thread::spawn(move || loop {
		tick(&handle);
		thread::sleep(Duration::from_secs(1));
	});
	Ok(())
}

fn tick(app: &AppHandle) {
	let timestamp = now();
	// 周期性清理过期记忆 (启动后第一次 + 每小时一次; 核心记忆 importance>=1.0 保留)
	let cleanup_tick = CLEANUP_TICK.fetch_add(1, Ordering::Relaxed) + 1;
	if cleanup_tick == 1 || cleanup_tick % MEMORY_CLEANUP_INTERVAL == 0 {
		if let Some(state) = app.try_state::<db::Db>() {
			if let Ok(conn) = state.0.lock() {
				let deleted = conn
					.execute(
						"DELETE FROM memories
						 WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?1 AND importance < 1.0",
						rusqlite::params![timestamp],
					)
					.unwrap_or(0);
				if deleted > 0 {
					let _ = log::write(app, &LogSource::Backend, "info", &format!("记忆清理: 过期删除 {deleted} 条"));
				}
			}
		}
	}

	// 用 try_state 防御: DB 状态未就绪时跳过本轮
	let Some(state) = app.try_state::<db::Db>() else {
		return;
	};
	let conn = match state.0.lock() {
		Ok(conn) => conn,
		Err(error) => {
			let _ = log::write(app, &LogSource::Backend, "error", &format!("定时任务调度: 数据库锁失败: {error}"));
			return;
		}
	};
	let tasks = match repository::list_enabled(&conn) {
		Ok(tasks) => tasks,
		Err(error) => {
			let _ = log::write(app, &LogSource::Backend, "error", &format!("定时任务调度: 读取任务失败: {error}"));
			return;
		}
	};
	drop(conn);

	let scheduler = app.state::<SchedulerState>();
	let mut fired: Vec<TaskRecord> = Vec::new();
	{
		let Ok(mut last_fired) = scheduler.0.lock() else {
			return;
		};
		for task in &tasks {
			if task.kind == "once" {
				if let Some(at) = next::once_at(&task.schedule) {
					if at <= timestamp {
						fired.push(task.clone());
					}
				}
			} else {
				// 上次触发时刻若早于任务更新时间 (任务被改过), 视为从当前时刻起算, 避免补发"过去的"时间
				let last = last_fired
					.get(&task.id)
					.copied()
					.filter(|&t| t >= task.updated_at)
					.unwrap_or(timestamp);
				if let Some(next_ts) = next::next_recurring(&task.schedule, last) {
					if next_ts <= timestamp {
						last_fired.insert(task.id, next_ts);
						fired.push(task.clone());
					}
				}
			}
		}
	}

	if fired.is_empty() {
		return;
	}
	for task in &fired {
		let _ = app.emit(
			SCHEDULED_TASK_EVENT,
			json!({ "id": task.id, "title": task.title, "content": task.content }),
		);
	}
	// 一次性任务触发后删除
	let Ok(conn) = state.0.lock() else {
		return;
	};
	for task in &fired {
		if task.kind == "once" {
			let _ = repository::delete(&conn, task.id);
		}
	}
}
