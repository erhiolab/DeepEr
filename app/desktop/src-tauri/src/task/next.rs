//! 下一次执行时刻计算
//!
//! schedule 是一个 JSON 数组, 每条目支持:
//! - `{"type":"once","at":<unix秒>}`        一次性 (临时任务)
//! - `{"type":"hourly","minute":30}`        每小时第 30 分
//! - `{"type":"daily","time":"09:00"}`      每天 09:00
//! - `{"type":"weekly","weekdays":[1,3],"time":"09:00"}`  每周一/三 09:00 (1=周一..7=周日)

use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike};
use serde_json::Value;

/// 时间戳 → 本地时间 (无效返回 None)
fn to_local(secs: i64) -> Option<DateTime<Local>> {
	DateTime::from_timestamp(secs, 0).map(|dt| dt.with_timezone(&Local))
}

/// 解析 "HH:MM"
fn parse_hhmm(time: &str) -> Option<(u32, u32)> {
	let mut parts = time.split(':');
	let hour = parts.next()?.parse::<u32>().ok()?;
	let minute = parts.next()?.parse::<u32>().ok()?;
	if hour < 24 && minute < 60 {
		Some((hour, minute))
	} else {
		None
	}
}

/// 每小时的 minute 分
fn hourly_next(after: i64, minute: u32) -> Option<i64> {
	let after_dt = to_local(after)?;
	let naive = after_dt.date_naive().and_hms_opt(after_dt.hour(), minute.min(59), 0)?;
	let mut candidate = Local.from_local_datetime(&naive).single()?;
	if candidate <= after_dt {
		candidate = candidate + Duration::hours(1);
	}
	Some(candidate.timestamp())
}

/// 每天的 HH:MM
fn daily_next(after: i64, hhmm: &str) -> Option<i64> {
	let (hour, minute) = parse_hhmm(hhmm)?;
	let after_dt = to_local(after)?;
	let naive = after_dt.date_naive().and_hms_opt(hour, minute, 0)?;
	let mut candidate = Local.from_local_datetime(&naive).single()?;
	if candidate <= after_dt {
		candidate = candidate + Duration::days(1);
	}
	Some(candidate.timestamp())
}

/// 每周指定星期几的 HH:MM (1=周一..7=周日)
fn weekly_next(after: i64, weekdays: &[u32], hhmm: &str) -> Option<i64> {
	let (hour, minute) = parse_hhmm(hhmm)?;
	let after_dt = to_local(after)?;
	let today_weekday = after_dt.weekday().number_from_monday() as i64;
	let mut best: Option<i64> = None;
	for &weekday in weekdays {
		let weekday = weekday as i64;
		if !(1..=7).contains(&weekday) {
			continue;
		}
		let days_ahead = (weekday - today_weekday).rem_euclid(7);
		let naive = after_dt.date_naive().and_hms_opt(hour, minute, 0)?;
		let mut candidate = Local.from_local_datetime(&naive).single()?;
		if days_ahead > 0 {
			candidate = candidate + Duration::days(days_ahead);
		} else if candidate <= after_dt {
			candidate = candidate + Duration::days(7);
		}
		let candidate_ts = candidate.timestamp();
		best = Some(best.map_or(candidate_ts, |b| b.min(candidate_ts)));
	}
	best
}

/// 任务下一次循环时刻 (忽略 once 条目, 供永久任务调度)
pub fn next_recurring(schedule: &Value, after: i64) -> Option<i64> {
	let entries = schedule.as_array()?;
	let mut best: Option<i64> = None;
	for entry in entries {
		let entry_type = entry.get("type").and_then(|v| v.as_str())?;
		let candidate = match entry_type {
			"hourly" => {
				let minute = entry.get("minute").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
				hourly_next(after, minute)
			}
			"daily" => {
				let time = entry.get("time").and_then(|v| v.as_str()).unwrap_or("00:00");
				daily_next(after, time)
			}
			"weekly" => {
				let weekdays: Vec<u32> = entry
					.get("weekdays")
					.and_then(|v| v.as_array())
					.map(|array| {
						array
							.iter()
							.filter_map(|v| v.as_u64())
							.map(|d| d as u32)
							.collect()
					})
					.unwrap_or_default();
				let time = entry.get("time").and_then(|v| v.as_str()).unwrap_or("00:00");
				weekly_next(after, &weekdays, time)
			}
			_ => None,
		};
		if let Some(ts) = candidate {
			best = Some(best.map_or(ts, |b| b.min(ts)));
		}
	}
	best
}

/// 一次性任务的执行时刻 (取第一条 once 条目)
pub fn once_at(schedule: &Value) -> Option<i64> {
	schedule.as_array()?.iter().find_map(|entry| {
		if entry.get("type").and_then(|v| v.as_str()) == Some("once") {
			entry.get("at").and_then(|v| parse_once_at(v).ok())
		} else {
			None
		}
	})
}

/// 解析 once 条目的 at: 接受 Unix 秒(数字)或时间字符串 (YYYY-MM-DD HH:MM:SS / YYYY-MM-DD HH:MM, 按本地时区)
pub fn parse_once_at(at: &Value) -> Result<i64, String> {
	if let Some(timestamp) = at.as_i64() {
		return Ok(timestamp);
	}
	let text = at
		.as_str()
		.ok_or_else(|| "once 条目的 at 应为 Unix 秒或时间字符串".to_string())?;
	let raw = text.trim();
	// 带时区偏移 / Z 的 ISO 字符串 (如 2026-08-29T03:52:27Z / +08:00), 转本地时间
	if let Ok(datetime) = chrono::DateTime::parse_from_rfc3339(raw) {
		return Ok(datetime.with_timezone(&Local).timestamp());
	}
	// 无时区, 按本地时间解释
	let normalized = raw.replace('T', " ");
	let stripped = normalized.strip_suffix('Z').unwrap_or(&normalized).trim();
	for format in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
		if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(stripped, format) {
			if let Some(datetime) = Local.from_local_datetime(&naive).single() {
				return Ok(datetime.timestamp());
			}
		}
	}
	Err(format!(
		"无法解析 once 时间: {text}, 期望 Unix 秒或 YYYY-MM-DD HH:MM:SS"
	))
}

/// 展示用: 所有条目里最早的下一次 (once 允许已过期, 表示"立即")
pub fn next_overall(schedule: &Value, after: i64) -> Option<i64> {
	let once = once_at(schedule);
	let recurring = next_recurring(schedule, after);
	match (once, recurring) {
		(Some(a), Some(b)) => Some(a.min(b)),
		(Some(a), None) => Some(a),
		(None, Some(b)) => Some(b),
		(None, None) => None,
	}
}
