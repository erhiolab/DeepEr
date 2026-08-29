//! 定时任务命令模块
//!
//! tasks 表存放任务定义 (title / content / kind / schedule JSON / enabled),
//! 调度线程在后台运行, 到点 emit `scheduled-task-due`. 前端只负责增删改查与展示.

use serde_json::Value;

use crate::db;
use crate::task::model::TaskRecord;
use crate::task::scheduler::SchedulerState;
use crate::task::{next, repository};

/// 写入参数 (创建 / 更新共用)
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpsertArgs {
	pub title: String,
	pub content: String,
	/// permanent / once
	pub kind: String,
	/// 时间设定 JSON 数组
	pub schedule: Value,
}

/// 下一个任务 (展示用)
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextTaskRecord {
	pub task: TaskRecord,
	pub at: i64,
}

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 全部任务
/// invoke("task_list")
#[tauri::command]
pub fn task_list(state: tauri::State<'_, db::Db>) -> Result<Vec<TaskRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::list(&conn)
}

/// 新建任务
/// invoke("task_create", { args: { title, content, kind, schedule } })
#[tauri::command]
pub fn task_create(
	state: tauri::State<'_, db::Db>,
	scheduler: tauri::State<'_, SchedulerState>,
	args: TaskUpsertArgs,
) -> Result<TaskRecord, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let timestamp = now();
	let id = repository::create(&conn, &args.title, &args.content, &args.kind, &args.schedule, timestamp)?;
	drop(conn);
	// 新任务从创建时刻开始算下一次, 避免触发过去的循环时间
	if let Ok(mut last_fired) = scheduler.0.lock() {
		last_fired.insert(id, timestamp);
	}
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::get(&conn, id)?.ok_or_else(|| "任务不存在".to_string())
}

/// 更新任务
/// invoke("task_update", { id, args: { title, content, kind, schedule } })
#[tauri::command]
pub fn task_update(
	state: tauri::State<'_, db::Db>,
	scheduler: tauri::State<'_, SchedulerState>,
	id: i64,
	args: TaskUpsertArgs,
) -> Result<TaskRecord, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let timestamp = now();
	repository::update(&conn, id, &args.title, &args.content, &args.kind, &args.schedule, timestamp)?;
	drop(conn);
	if let Ok(mut last_fired) = scheduler.0.lock() {
		last_fired.insert(id, timestamp);
	}
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::get(&conn, id)?.ok_or_else(|| "任务不存在".to_string())
}

/// 删除任务
/// invoke("task_delete", { id })
#[tauri::command]
pub fn task_delete(
	state: tauri::State<'_, db::Db>,
	scheduler: tauri::State<'_, SchedulerState>,
	id: i64,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::delete(&conn, id)?;
	drop(conn);
	if let Ok(mut last_fired) = scheduler.0.lock() {
		last_fired.remove(&id);
	}
	Ok(())
}

/// 下一个要执行的任务 (展示用; 按当前时间取最早下一次)
/// invoke("task_next")
#[tauri::command]
pub fn task_next(state: tauri::State<'_, db::Db>) -> Result<Option<NextTaskRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let tasks = repository::list_enabled(&conn)?;
	let timestamp = now();
	let mut best: Option<NextTaskRecord> = None;
	for task in tasks {
		if let Some(at) = next::next_overall(&task.schedule, timestamp) {
			if best.as_ref().map_or(true, |current: &NextTaskRecord| at < current.at) {
				best = Some(NextTaskRecord { task, at });
			}
		}
	}
	Ok(best)
}

/// 切换任务启用状态
/// invoke("task_set_enabled", { id, enabled })
#[tauri::command]
pub fn task_set_enabled(
	state: tauri::State<'_, db::Db>,
	scheduler: tauri::State<'_, SchedulerState>,
	id: i64,
	enabled: bool,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	repository::set_enabled(&conn, id, enabled)?;
	drop(conn);
	if let Ok(mut last_fired) = scheduler.0.lock() {
		if enabled {
			// 启用时重置, 避免补发停用期间错过的循环时间
			last_fired.insert(id, now());
		} else {
			last_fired.remove(&id);
		}
	}
	Ok(())
}
