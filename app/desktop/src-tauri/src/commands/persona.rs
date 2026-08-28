//! 人设 (角色卡) 命令模块
//!
//! `personas` 表存储人设记录: 名称 / 描述 / 性格 / 场景 / 开场白 / 示例对话等.
//! 当前选中的人设 id 写入 config 表 `selected_persona_id` (由 `persona_select` 维护),
//! 对话系统启动时可直接读取该配置键使用对应人设.
//! 支持导入 SillyTavern 角色卡: JSON 卡直接解析, PNG 卡读取内嵌 `chara` tEXt 段,
//! 并把 PNG 本身作为人设头像保存到 `resources/personas/avatars/<id>.png`.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::config::{self, ConfigValue};
use crate::db;
use crate::resource;

/// 配置键: 当前选中的人设 id
pub const KEY_SELECTED_PERSONA_ID: &str = "selected_persona_id";

/// 人设来源: 手动创建
const SOURCE_MANUAL: &str = "manual";
/// 人设来源: SillyTavern 角色卡导入
const SOURCE_SILLYTAVERN: &str = "sillytavern";

/// 人设记录 (返回给前端, 与前端 Persona 接口 camelCase 对齐)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaRecord {
	pub id: i64,
	pub name: String,
	pub personality: String,
	pub first_mes: String,
	pub avatar_path: Option<String>,
	pub source: String,
	pub created_at: i64,
	pub updated_at: i64,
}

/// 人设写入参数 (创建 / 更新共用)
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaUpsertArgs {
	/// 人设名称 (必填)
	pub name: String,
	/// 人设 (性格 / 背景等设定)
	#[serde(default)]
	pub personality: String,
	/// 开场白
	#[serde(default)]
	pub first_mes: String,
}

/// 从角色卡 JSON 中解析出的人设字段
struct PersonaFields {
	name: String,
	personality: String,
	first_mes: String,
}

/// 当前时间戳 (秒)
fn now() -> i64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_secs() as i64)
		.unwrap_or(0)
}

/// 从 SQLite 行读取人设记录
fn row_to_persona(row: &Row<'_>) -> rusqlite::Result<PersonaRecord> {
	Ok(PersonaRecord {
		id: row.get(0)?,
		name: row.get(1)?,
		personality: row.get(2)?,
		first_mes: row.get(3)?,
		avatar_path: row.get(4)?,
		source: row.get(5)?,
		created_at: row.get(6)?,
		updated_at: row.get(7)?,
	})
}

const PERSONA_COLUMNS: &str = "
    id, name, personality, first_mes, avatar_path, source, created_at, updated_at
";

/// 校验人设名称
fn validate_name(name: &str) -> Result<(), String> {
	if name.trim().is_empty() {
		return Err("人设名称不能为空".to_string());
	}
	if name.chars().any(char::is_control) {
		return Err("人设名称不能包含控制字符".to_string());
	}
	Ok(())
}

/// 按 id 读取人设, 不存在返回错误
fn get_persona_by_id(conn: &Connection, id: i64) -> Result<PersonaRecord, String> {
	let sql = format!("SELECT {PERSONA_COLUMNS} FROM personas WHERE id = ?1");
	conn.query_row(&sql, params![id], |row| row_to_persona(row))
		.map_err(|e| match e {
			rusqlite::Error::QueryReturnedNoRows => format!("人设不存在: {id}"),
			other => format!("读取人设失败: {other}"),
		})
}

/// 列出全部人设 (按创建时间正序)
/// invoke("persona_list")
#[tauri::command]
pub fn persona_list(state: tauri::State<'_, db::Db>) -> Result<Vec<PersonaRecord>, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let sql = format!("SELECT {PERSONA_COLUMNS} FROM personas ORDER BY id ASC");
	let mut stmt = conn
		.prepare(&sql)
		.map_err(|e| format!("查询人设失败: {e}"))?;
	let rows = stmt
		.query_map([], |row| row_to_persona(row))
		.map_err(|e| format!("读取人设失败: {e}"))?
		.collect::<Result<Vec<_>, _>>()
		.map_err(|e| format!("解析人设失败: {e}"))?;
	Ok(rows)
}

/// 读取单个人设
/// invoke("persona_get", { id: 1 })
#[tauri::command]
pub fn persona_get(state: tauri::State<'_, db::Db>, id: i64) -> Result<PersonaRecord, String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	get_persona_by_id(&conn, id)
}

/// 创建人设
/// invoke("persona_create", { args: { name: "...", personality: "...", firstMes: "..." } })
#[tauri::command]
pub fn persona_create(
	state: tauri::State<'_, db::Db>,
	args: PersonaUpsertArgs,
) -> Result<PersonaRecord, String> {
	validate_name(&args.name)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let timestamp = now();
	conn.execute(
		"INSERT INTO personas (
			name, personality, first_mes, source, created_at, updated_at
		 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
		params![
			args.name.trim(),
			args.personality,
			args.first_mes,
			SOURCE_MANUAL,
			timestamp,
			timestamp
		],
	)
	.map_err(|e| format!("创建人设失败: {e}"))?;
	let id = conn.last_insert_rowid();
	get_persona_by_id(&conn, id)
}

/// 更新人设
/// invoke("persona_update", { id: 1, args: { name: "...", ... } })
#[tauri::command]
pub fn persona_update(
	state: tauri::State<'_, db::Db>,
	id: i64,
	args: PersonaUpsertArgs,
) -> Result<PersonaRecord, String> {
	validate_name(&args.name)?;
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let affected = conn
		.execute(
			"UPDATE personas SET
				name = ?1, personality = ?2, first_mes = ?3, updated_at = ?4
			 WHERE id = ?5",
			params![
				args.name.trim(),
				args.personality,
				args.first_mes,
				now(),
				id
			],
		)
		.map_err(|e| format!("更新人设失败: {e}"))?;
	if affected == 0 {
		return Err(format!("人设不存在: {id}"));
	}
	get_persona_by_id(&conn, id)
}

/// 删除人设: 同时清理头像文件; 若被删的是当前选中人设则清除选择
/// invoke("persona_delete", { id: 1 })
#[tauri::command]
pub fn persona_delete(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	id: i64,
) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	// 读取记录, 用于清理头像 / 判断是否为当前选中
	let record = get_persona_by_id(&conn, id)?;
	let affected = conn
		.execute("DELETE FROM personas WHERE id = ?1", params![id])
		.map_err(|e| format!("删除人设失败: {e}"))?;
	if affected == 0 {
		return Err(format!("人设不存在: {id}"));
	}
	// 清理头像文件 (失败不阻断删除)
	if let Some(avatar_path) = &record.avatar_path {
		let _ = remove_avatar_file(&app, avatar_path);
	}
	// 被删的是当前选中人设时, 清除选中配置
	if let Ok(Some(ConfigValue::Integer(selected))) = config::get(&conn, KEY_SELECTED_PERSONA_ID) {
		if selected == id {
			let _ = config::delete(&conn, KEY_SELECTED_PERSONA_ID);
		}
	}
	Ok(())
}

/// 设置 / 清除当前选中人设 (null = 清除选择)
/// invoke("persona_select", { id: 1 })
#[tauri::command]
pub fn persona_select(state: tauri::State<'_, db::Db>, id: Option<i64>) -> Result<(), String> {
	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	match id {
		Some(selected) => {
			get_persona_by_id(&conn, selected)?;
			config::set(&conn, KEY_SELECTED_PERSONA_ID, &ConfigValue::Integer(selected))
				.map_err(|e| format!("保存选中人设失败: {e}"))?;
		}
		None => {
			config::delete(&conn, KEY_SELECTED_PERSONA_ID)
				.map_err(|e| format!("清除选中人设失败: {e}"))?;
		}
	}
	Ok(())
}

/// 导入 SillyTavern 角色卡文件 (.json 或 .png)
/// invoke("persona_import_file", { path: "C:/cards/xxx.png" })
#[tauri::command]
pub fn persona_import_file(
	app: AppHandle,
	state: tauri::State<'_, db::Db>,
	path: String,
) -> Result<PersonaRecord, String> {
	let file_path = PathBuf::from(&path);
	if !file_path.is_file() {
		return Err(format!("角色卡文件不存在: {path}"));
	}
	let bytes = fs::read(&file_path).map_err(|e| format!("读取角色卡失败: {e}"))?;
	// PNG 卡: 读内嵌 chara 段并整图作为头像; JSON 卡: 直接解析
	let (card_json, avatar_png) = if is_png(&bytes) {
		let raw = extract_png_chara(&bytes)
			.ok_or_else(|| "PNG 角色卡中未找到 chara 数据段".to_string())?;
		let decoded = decode_base64(&raw).ok_or_else(|| "角色卡 chara 数据解码失败".to_string())?;
		let json: Value = serde_json::from_slice(&decoded)
			.map_err(|e| format!("角色卡 JSON 解析失败: {e}"))?;
		(json, Some(bytes))
	} else {
		let text = String::from_utf8(bytes.clone())
			.map_err(|_| "角色卡不是 UTF-8 文本".to_string())?;
		let json: Value = serde_json::from_str(&text)
			.map_err(|e| format!("角色卡 JSON 解析失败: {e}"))?;
		(json, None)
	};
	let file_stem = file_path
		.file_stem()
		.and_then(|s| s.to_str())
		.unwrap_or("角色卡")
		.to_string();
	let fields = parse_sillytavern_card(&card_json, &file_stem);
	validate_name(&fields.name)?;

	let conn = state
		.0
		.lock()
		.map_err(|e| format!("获取数据库连接失败: {e}"))?;
	let timestamp = now();
	let source_data = serde_json::to_string(&card_json).unwrap_or_else(|_| "{}".to_string());
	conn.execute(
		"INSERT INTO personas (
			name, personality, first_mes, source, source_data, created_at, updated_at
		 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
		params![
			fields.name,
			fields.personality,
			fields.first_mes,
			SOURCE_SILLYTAVERN,
			source_data,
			timestamp,
			timestamp
		],
	)
	.map_err(|e| format!("导入人设失败: {e}"))?;
	let id = conn.last_insert_rowid();

	// PNG 卡: 保存头像并回填 avatar_path
	if let Some(png) = avatar_png {
		if let Ok(relative) = save_avatar_file(&app, id, &png) {
			let _ = conn.execute(
				"UPDATE personas SET avatar_path = ?1 WHERE id = ?2",
				params![relative, id],
			);
		}
	}
	get_persona_by_id(&conn, id)
}

/// 判断是否为 PNG 文件 (魔数校验)
fn is_png(data: &[u8]) -> bool {
	const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
	data.len() >= 8 && data[..8] == PNG_SIGNATURE
}

/// 从 PNG 字节流中提取 tEXt 段 keyword 为 "chara" 的内容 (SillyTavern 角色卡格式)
fn extract_png_chara(data: &[u8]) -> Option<Vec<u8>> {
	let mut offset = 8usize;
	while offset + 8 <= data.len() {
		let length =
			u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
				as usize;
		let chunk_type = &data[offset + 4..offset + 8];
		let data_start = offset + 8;
		if data_start + length + 4 > data.len() {
			break;
		}
		if chunk_type == b"tEXt" {
			let chunk = &data[data_start..data_start + length];
			// tEXt 格式: keyword \0 text (keyword 为 Latin-1, text 为 Latin-1)
			if let Some(nul) = chunk.iter().position(|&b| b == 0) {
				let keyword = &chunk[..nul];
				if keyword.eq_ignore_ascii_case(b"chara") {
					return Some(chunk[nul + 1..].to_vec());
				}
			}
		}
		if chunk_type == b"IEND" {
			break;
		}
		offset = data_start + length + 4;
	}
	None
}

/// 宽松 base64 解码: 先按带填充解, 失败再按无填充解
fn decode_base64(input: &[u8]) -> Option<Vec<u8>> {
	use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
	let text = std::str::from_utf8(input).ok()?;
	let trimmed = text.trim();
	STANDARD.decode(trimmed).or_else(|_| STANDARD_NO_PAD.decode(trimmed)).ok()
}

/// 从 SillyTavern 角色卡 JSON 提取人设字段 (缺省字段回退为空字符串 / 文件名)
fn parse_sillytavern_card(json: &Value, file_stem: &str) -> PersonaFields {
	let get = |key: &str| -> String {
		json.get(key)
			.and_then(|v| v.as_str())
			.map(|s| s.to_string())
			.unwrap_or_default()
	};
	let name = {
		let card_name = get("name");
		if card_name.trim().is_empty() {
			file_stem.to_string()
		} else {
			card_name
		}
	};
	let mut personality_parts: Vec<String> = Vec::new();
	for part in [get("description"), get("personality"), get("scenario")] {
		let trimmed = part.trim().to_string();
		if !trimmed.is_empty() {
			personality_parts.push(trimmed);
		}
	}
	PersonaFields {
		name,
		personality: personality_parts.join("\n"),
		first_mes: get("first_mes"),
	}
}

/// 保存人设头像到 resources/personas/avatars/<id>.png, 返回 asset 相对路径
fn save_avatar_file(app: &AppHandle, id: i64, png: &[u8]) -> Result<String, String> {
	let resources = resource::resources_dir(app)?;
	let avatar_dir = resources.join("personas").join("avatars");
	fs::create_dir_all(&avatar_dir)
		.map_err(|e| format!("创建头像目录失败: {e}"))?;
	let file_name = format!("{id}.png");
	let target = avatar_dir.join(&file_name);
	fs::write(&target, png).map_err(|e| format!("保存头像失败: {e}"))?;
	Ok(format!("personas/avatars/{file_name}"))
}

/// 删除人设头像文件 (仅允许 resources/personas/avatars 内的文件)
fn remove_avatar_file(app: &AppHandle, avatar_path: &str) -> Result<(), String> {
	let resources = resource::resources_dir(app)?;
	let canonical_resources = resources
		.canonicalize()
		.map_err(|e| format!("资源目录不可用: {e}"))?;
	// 仅允许相对路径且落在 personas/avatars 目录内
	let relative = avatar_path.replace('\\', "/");
	let relative = relative.trim_start_matches('/');
	let segments: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
	if segments.len() != 3 || segments[0] != "personas" || segments[1] != "avatars" {
		return Err("非法头像路径".to_string());
	}
	let target = canonical_resources.join(relative);
	let canonical_target = match target.canonicalize() {
		Ok(path) => path,
		Err(_) => return Ok(()), // 文件已不存在
	};
	if !canonical_target.starts_with(&canonical_resources) {
		return Err("非法头像路径".to_string());
	}
	let _ = fs::remove_file(&canonical_target);
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 构造带 chara 段的 PNG 字节流 (CRC 段填 0, 解析器不校验)
	fn make_png_with_chara(card_json: &str) -> Vec<u8> {
		let mut data = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
		let push_chunk = |data: &mut Vec<u8>, chunk_type: &[u8; 4], chunk: &[u8]| {
			data.extend_from_slice(&(chunk.len() as u32).to_be_bytes());
			data.extend_from_slice(chunk_type);
			data.extend_from_slice(chunk);
			data.extend_from_slice(&[0, 0, 0, 0]);
		};
		// IHDR (占位)
		push_chunk(&mut data, b"IHDR", &[0u8; 13]);
		// tEXt: keyword \0 text
		let mut text = b"chara".to_vec();
		text.push(0);
		use base64::engine::general_purpose::STANDARD;
		text.extend_from_slice(STANDARD.encode(card_json).as_bytes());
		push_chunk(&mut data, b"tEXt", &text);
		// IDAT 占位
		push_chunk(&mut data, b"IDAT", &[1, 2, 3]);
		// IEND
		push_chunk(&mut data, b"IEND", &[]);
		data
	}

	#[test]
	fn extracts_chara_from_png() {
		let png = make_png_with_chara(r#"{"name":"测试角色"}"#);
		assert!(is_png(&png));
		let raw = extract_png_chara(&png).expect("应提取到 chara 段");
		let decoded = decode_base64(&raw).expect("chara 段应为 base64");
		let json: Value = serde_json::from_slice(&decoded).expect("chara 段应为 JSON");
		assert_eq!(json["name"], "测试角色");
	}

	#[test]
	fn rejects_non_png() {
		assert!(!is_png(b"not a png"));
		assert!(extract_png_chara(b"not a png").is_none());
	}

	#[test]
	fn decodes_padded_and_unpadded_base64() {
		use base64::engine::general_purpose::STANDARD;
		let padded = STANDARD.encode(r#"{"name":"A"}"#);
		assert_eq!(decode_base64(padded.as_bytes()), Some(r#"{"name":"A"}"#.as_bytes().to_vec()));
		let unpadded = padded.trim_end_matches('=');
		assert_eq!(decode_base64(unpadded.as_bytes()), Some(r#"{"name":"A"}"#.as_bytes().to_vec()));
	}

	#[test]
	fn maps_sillytavern_card_fields() {
		let json: Value = serde_json::from_str(
			r#"{
				"name": "莉莉",
				"description": "来自深海的精灵",
				"personality": "温柔",
				"scenario": "海边小镇",
				"first_mes": "你好呀~"
			}"#,
		)
		.expect("测试 JSON 应合法");
		let fields = parse_sillytavern_card(&json, "fallback");
		assert_eq!(fields.name, "莉莉");
		// 描述/性格/场景合并进"人设"
		assert_eq!(fields.personality, "来自深海的精灵\n温柔\n海边小镇");
		assert_eq!(fields.first_mes, "你好呀~");
	}

	#[test]
	fn falls_back_to_file_stem_when_name_missing() {
		let json: Value = serde_json::from_str(r#"{"description":"无名"}"#).unwrap();
		let fields = parse_sillytavern_card(&json, "my-card");
		assert_eq!(fields.name, "my-card");
		assert_eq!(fields.personality, "无名");
		assert_eq!(fields.first_mes, "");
	}
}
