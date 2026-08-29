//! 数据库模块
//! Windows: %APPDATA%/<应用标识>/data/<DB_FILE_NAME>
//! macOS: ~/Library/Application Support/<应用标识>/data/<DB_FILE_NAME>
//! Linux: ~/.local/share/<应用标识>/data/<DB_FILE_NAME>

use rusqlite::Connection;
use std::error::Error as StdError;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::config::{self};
use crate::log::{self, LogSource};

/// 统一错误类型: 兼容 tauri setup(Box<dyn Error>)与 command(String)
pub type DbResult<T> = Result<T, Box<dyn StdError>>;

/// 数据库封装: 内部用 Mutex 包 Connection,供 Tauri state 跨命令共享
pub struct Db(pub Mutex<Connection>);

/// 建表
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
    id            TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    is_official   INTEGER NOT NULL DEFAULT 0,
    entry_file    TEXT,
    size          INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT
);
CREATE TABLE IF NOT EXISTS contexts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,
    role         TEXT,
    content      TEXT NOT NULL,
    token_count  INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    hit_rate     REAL,
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS personas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    personality TEXT NOT NULL DEFAULT '',
    first_mes   TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    source      TEXT NOT NULL DEFAULT 'manual',
    source_data TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tools (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    provider    TEXT NOT NULL DEFAULT 'internal',
    executor    TEXT NOT NULL DEFAULT '',
    input_schema TEXT NOT NULL DEFAULT '{}',
    config      TEXT NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    builtin     INTEGER NOT NULL DEFAULT 0,
    version     TEXT NOT NULL DEFAULT '1.0.0',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'permanent',
    schedule    TEXT NOT NULL DEFAULT '[]',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    content          TEXT NOT NULL,
    type             TEXT NOT NULL DEFAULT 'fact',
    importance       REAL NOT NULL DEFAULT 0.5,
    confidence       REAL NOT NULL DEFAULT 1.0,
    access_count     INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER,
    expires_at       INTEGER,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_tags (
    memory_id INTEGER NOT NULL,
    tag       TEXT NOT NULL
);
";

/// 数据库文件名
const DB_FILE_NAME: &str = "deeper.db";

/// 初始化数据库
pub fn init(app: &AppHandle) -> DbResult<Db> {
    let dir = data_dir(app)?;
    // 确保 data 目录存在
    std::fs::create_dir_all(&dir)?;
    let db_path = dir.join(DB_FILE_NAME);
    // 打开或创建 SQLite 数据库
    let conn = Connection::open(&db_path)?;
    // 创建数据库表
    conn.execute_batch(SCHEMA)?;
    // 初始化默认配置
    // 只补充缺失配置, 不覆盖用户已有配置.
    config::init_defaults(&conn)?;
    // 初始化内置工具 (幂等 upsert, 表结构以 SCHEMA 为准, 不做迁移)
    crate::tool::repository::init_defaults(&conn)?;
    // 记录数据库位置
    let _ = log::write(
        app,
        &LogSource::Backend,
        "info",
        &format!("数据库已打开: {}", db_path.display()),
    );

    Ok(Db(Mutex::new(conn)))
}

/// 获取应用数据目录
pub fn data_dir(app: &AppHandle) -> DbResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()?
        .join("data");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 获取 SQLite 数据库文件路径
pub fn database_path(app: &AppHandle) -> DbResult<PathBuf> {
    Ok(data_dir(app)?.join(DB_FILE_NAME))
}
