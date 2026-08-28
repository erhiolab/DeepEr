//! 配置模块

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error as StdError;

pub type ConfigResult<T> = Result<T, Box<dyn StdError>>;

/// 配置值类型: 支持基础类型和 JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConfigValue {
    String(String),
    Integer(i64),
    Boolean(bool),
    Json(Value),
}

impl ConfigValue {
    /// 转换成 SQLite 中保存的字符串
    pub fn to_storage(&self) -> String {
        match self {
            ConfigValue::String(value) => value.clone(),
            ConfigValue::Integer(value) => value.to_string(),
            ConfigValue::Boolean(value) => {
                if *value {
                    "1".to_string()
                } else {
                    "0".to_string()
                }
            }
            ConfigValue::Json(value) => value.to_string(),
        }
    }

    /// 从 SQLite 保存的字符串恢复 ConfigValue
    pub fn from_storage(value: &str) -> ConfigResult<Self> {
        // Boolean
        if value == "1" || value.eq_ignore_ascii_case("true") {
            return Ok(ConfigValue::Boolean(true));
        }
        if value == "0" || value.eq_ignore_ascii_case("false") {
            return Ok(ConfigValue::Boolean(false));
        }
        // Integer
        if let Ok(number) = value.parse::<i64>() {
            return Ok(ConfigValue::Integer(number));
        }
        // JSON
        if let Ok(json) = serde_json::from_str::<Value>(value) {
            match json {
                Value::Object(_) | Value::Array(_) => {
                    return Ok(ConfigValue::Json(json));
                }
                _ => {}
            }
        }
        // 默认字符串
        Ok(ConfigValue::String(value.to_string()))
    }
}

/// 读取配置
pub fn get(conn: &Connection, key: &str) -> ConfigResult<Option<ConfigValue>> {
    let result = conn.query_row(
        "SELECT value FROM config WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(value) => Ok(Some(ConfigValue::from_storage(&value)?)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// 写入配置
pub fn set(conn: &Connection, key: &str, value: &ConfigValue) -> ConfigResult<()> {
    conn.execute(
        r#"
        INSERT INTO config (key, value)
        VALUES (?1, ?2)
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value
        "#,
        params![key, value.to_storage()],
    )?;
    Ok(())
}

/// 删除配置, 返回是否真的删除了记录
pub fn delete(conn: &Connection, key: &str) -> ConfigResult<bool> {
    let affected = conn.execute("DELETE FROM config WHERE key = ?1", params![key])?;
    Ok(affected > 0)
}

/// 判断配置是否存在
pub fn exists(conn: &Connection, key: &str) -> ConfigResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM config WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// 获取所有配置
pub fn get_all(conn: &Connection) -> ConfigResult<Vec<(String, ConfigValue)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM config ORDER BY key")?;
    let rows = stmt.query_map([], |row| {
        let key = row.get::<_, String>(0)?;
        let value = row.get::<_, String>(1)?;
        Ok((key, value))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (key, value) = row?;
        let value = ConfigValue::from_storage(&value).unwrap_or(ConfigValue::String(value));
        result.push((key, value));
    }
    Ok(result)
}

/// 读取字符串配置, 缺失/类型不符时返回 fallback
pub fn get_str_or(conn: &Connection, key: &str, fallback: &str) -> String {
    match get(conn, key) {
        Ok(Some(ConfigValue::String(value))) if !value.is_empty() => value,
        Ok(Some(ConfigValue::Integer(value))) => value.to_string(),
        Ok(Some(ConfigValue::Boolean(value))) => value.to_string(),
        _ => fallback.to_string(),
    }
}

/// 配置键: 首次启动 (数据库创建) 时间
pub const KEY_INSTALLED_AT: &str = "installed_at";
/// 配置键: 首次初始化完成时间
pub const KEY_INITIALIZED_AT: &str = "initialized_at";
/// 配置键: 应用版本 (首次安装时的版本)
pub const KEY_APP_VERSION: &str = "app_version";
/// 配置键: 界面语言
pub const KEY_LANGUAGE: &str = "language";
/// 配置键: 首次初始化是否已完成
pub const KEY_FIRST_RUN_COMPLETED: &str = "first_run_completed";

/// 当前本地时间, 形如 2026-01-01 12:00:00
fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 系统语言, 获取失败时回退 zh-CN
fn system_language() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "zh-CN".to_string())
}

/// 初始化默认配置
pub fn init_defaults(conn: &Connection) -> ConfigResult<()> {
    let defaults = [
        (
            KEY_APP_VERSION,
            ConfigValue::String(env!("CARGO_PKG_VERSION").to_string()),
        ),
        (KEY_INSTALLED_AT, ConfigValue::String(now())),
        (KEY_LANGUAGE, ConfigValue::String(system_language())),
        (KEY_FIRST_RUN_COMPLETED, ConfigValue::Boolean(false)),
    ];
    for (key, value) in defaults {
        conn.execute(
            r#"
            INSERT OR IGNORE INTO config (key, value)
            VALUES (?1, ?2)
            "#,
            params![key, value.to_storage()],
        )?;
    }
    Ok(())
}

/// 判断是否首次启动
pub fn is_first_run(conn: &Connection) -> ConfigResult<bool> {
    match get(conn, KEY_FIRST_RUN_COMPLETED)? {
        None => Ok(true),
        Some(ConfigValue::Boolean(value)) => Ok(!value),
        Some(ConfigValue::Integer(value)) => Ok(value == 0),
        Some(ConfigValue::String(value)) => {
            Ok(value == "0" || value.eq_ignore_ascii_case("false"))
        }
        Some(ConfigValue::Json(_)) => Ok(false),
    }
}

/// 首次初始化配置快照
/// 使用 camelCase 与前端 TypeScript 接口保持一致
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitConfig {
    pub app_version: String,
    pub installed_at: String,
    pub initialized_at: Option<String>,
    pub language: String,
}

/// 获取首次初始化配置
#[tauri::command]
pub fn get_init_config(state: tauri::State<'_, crate::db::Db>) -> Result<InitConfig, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let initialized_at = match get(&conn, KEY_INITIALIZED_AT).map_err(|e| e.to_string())? {
        Some(ConfigValue::String(value)) if !value.is_empty() => Some(value),
        _ => None,
    };
    let language_fallback = system_language();
    Ok(InitConfig {
        app_version: get_str_or(&conn, KEY_APP_VERSION, "unknown"),
        installed_at: get_str_or(&conn, KEY_INSTALLED_AT, ""),
        initialized_at,
        language: get_str_or(&conn, KEY_LANGUAGE, &language_fallback),
    })
}

/// 前端读取配置
#[tauri::command]
pub fn get_config(
    state: tauri::State<'_, crate::db::Db>,
    key: String,
) -> Result<Option<ConfigValue>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get(&conn, &key).map_err(|e| e.to_string())
}

/// 前端写入配置
#[tauri::command]
pub fn set_config(
    state: tauri::State<'_, crate::db::Db>,
    key: String,
    value: ConfigValue,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set(&conn, &key, &value).map_err(|e| e.to_string())
}

/// 前端删除配置
#[tauri::command]
pub fn delete_config(state: tauri::State<'_, crate::db::Db>, key: String) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete(&conn, &key).map_err(|e| e.to_string())
}

/// 前端检查配置是否存在
#[tauri::command]
pub fn has_config(state: tauri::State<'_, crate::db::Db>, key: String) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    exists(&conn, &key).map_err(|e| e.to_string())
}

/// 前端获取全部配置
#[tauri::command]
pub fn get_all_configs(
    state: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<(String, ConfigValue)>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_all(&conn).map_err(|e| e.to_string())
}
