//! 主页统计命令模块
//!
//! 一次命令汇总主页需要的全部数据: 对话/token/命中率统计、记忆/工具/定时任务数量、
//! 下一个定时任务、近 7 天活跃度. 前端不用逐条拉取再自己算.

use std::collections::HashMap;

use chrono::{Duration, Local, TimeZone};
use serde::Serialize;

use crate::db;
use crate::task::{next as task_next, repository as task_repository};

/// 某天消息数 (图表)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
	pub day: String,
	pub messages: i64,
	pub tokens: i64,
}

/// 主页统计数据
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeStats {
	pub total_messages: i64,
	pub user_messages: i64,
	pub assistant_messages: i64,
	pub today_messages: i64,
	pub total_input_tokens: i64,
	pub total_output_tokens: i64,
	pub today_input_tokens: i64,
	pub today_output_tokens: i64,
	pub avg_hit_rate: Option<f64>,
	pub memory_count: i64,
	pub tool_count: i64,
	pub enabled_task_count: i64,
	pub next_task_title: Option<String>,
	pub next_task_at: Option<i64>,
	pub daily_activity: Vec<DailyActivity>,
}

fn now() -> i64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 本地今天零点 (Unix 秒)
fn today_start() -> i64 {
	let local_now = Local::now();
	let midnight = local_now
		.date_naive()
		.and_hms_opt(0, 0, 0)
		.expect("有效零点");
	Local
		.from_local_datetime(&midnight)
		.single()
		.map(|dt| dt.timestamp())
		.unwrap_or_else(|| local_now.timestamp())
}

/// 主页统计
/// invoke("stats_home")
#[tauri::command]
pub fn stats_home(state: tauri::State<'_, db::Db>) -> Result<HomeStats, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let timestamp = now();
	let day_start = today_start();

	let (total_messages, user_messages, assistant_messages, total_input, total_output): (i64, i64, i64, i64, i64) = conn
		.query_row(
			"SELECT COUNT(*),
			        COALESCE(SUM(CASE WHEN role='user' THEN 1 ELSE 0 END), 0),
			        COALESCE(SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END), 0),
			        COALESCE(SUM(input_tokens), 0),
			        COALESCE(SUM(output_tokens), 0)
			 FROM contexts WHERE type='talk'",
			[],
			|row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
		)
		.map_err(|e| format!("统计对话失败: {e}"))?;

	let today_messages: i64 = conn
		.query_row(
			"SELECT COUNT(*) FROM contexts WHERE type='talk' AND created_at >= ?1",
			rusqlite::params![day_start],
			|row| row.get(0),
		)
		.map_err(|e| format!("统计今日消息失败: {e}"))?;

	let (today_input, today_output): (i64, i64) = conn
		.query_row(
			"SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
			 FROM contexts WHERE type='talk' AND created_at >= ?1",
			rusqlite::params![day_start],
			|row| Ok((row.get(0)?, row.get(1)?)),
		)
		.map_err(|e| format!("统计今日 token 失败: {e}"))?;

	let avg_hit_rate: Option<f64> = conn
		.query_row(
			"SELECT AVG(hit_rate) FROM contexts WHERE type='talk' AND role='assistant' AND hit_rate IS NOT NULL",
			[],
			|row| row.get(0),
		)
		.map_err(|e| format!("统计命中率失败: {e}"))?;

	let memory_count: i64 = conn
		.query_row(
			"SELECT COUNT(*) FROM memories WHERE status='active' AND (expires_at IS NULL OR expires_at > ?1)",
			rusqlite::params![timestamp],
			|row| row.get(0),
		)
		.map_err(|e| format!("统计记忆失败: {e}"))?;

	let tool_count: i64 = conn
		.query_row("SELECT COUNT(*) FROM tools", [], |row| row.get(0))
		.map_err(|e| format!("统计工具失败: {e}"))?;

	let enabled_task_count: i64 = conn
		.query_row("SELECT COUNT(*) FROM tasks WHERE enabled=1", [], |row| row.get(0))
		.map_err(|e| format!("统计定时任务失败: {e}"))?;

	// 下一个定时任务
	let tasks = task_repository::list_enabled(&conn)?;
	let mut next_task_title: Option<String> = None;
	let mut next_task_at: Option<i64> = None;
	for task in tasks {
		if let Some(at) = task_next::next_overall(&task.schedule, timestamp) {
			if next_task_at.map_or(true, |best| at < best) {
				next_task_at = Some(at);
				next_task_title = Some(task.title);
			}
		}
	}

	// 近 7 天活跃 (本地日期分组)
	let week_start = day_start - 6 * 86400;
	let mut stmt = conn
		.prepare(
			"SELECT date(created_at, 'unixepoch', 'localtime') AS day,
			        COUNT(*) AS n,
			        COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS tokens
			 FROM contexts WHERE type='talk' AND created_at >= ?1
			 GROUP BY day ORDER BY day",
		)
		.map_err(|e| format!("统计活跃失败: {e}"))?;
	let rows = stmt
		.query_map(rusqlite::params![week_start], |row| {
			Ok((
				row.get::<_, String>(0)?,
				row.get::<_, i64>(1)?,
				row.get::<_, i64>(2)?,
			))
		})
		.map_err(|e| format!("统计活跃失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("统计活跃失败: {e}"))?;
	let counts: HashMap<String, (i64, i64)> = rows
		.into_iter()
		.map(|(day, messages, tokens)| (day, (messages, tokens)))
		.collect();
	let mut daily_activity = Vec::with_capacity(7);
	for offset in (0..7).rev() {
		let day = (Local::now() - Duration::days(offset)).format("%Y-%m-%d").to_string();
		let (messages, tokens) = counts.get(&day).copied().unwrap_or((0, 0));
		daily_activity.push(DailyActivity { day, messages, tokens });
	}

	Ok(HomeStats {
		total_messages,
		user_messages,
		assistant_messages,
		today_messages,
		total_input_tokens: total_input,
		total_output_tokens: total_output,
		today_input_tokens: today_input,
		today_output_tokens: today_output,
		avg_hit_rate,
		memory_count,
		tool_count,
		enabled_task_count,
		next_task_title,
		next_task_at,
		daily_activity,
	})
}
