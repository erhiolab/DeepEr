//! Context 记录命令模块
//!
//! `contexts` 表用于记录对话 / 工具调用等上下文条目.
//! 前端(conversation / tts)在用户消息、AI 回复、TTS 合成时调用 `context_insert` 写入.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::db;

/// 插入一条 context 记录.
/// invoke("context_insert", { args: { type: "talk", role: "user", content: "...", tokenCount: 12 } })
#[tauri::command]
pub fn context_insert(
    state: tauri::State<'_, db::Db>,
    args: ContextInsertArgs,
) -> Result<u64, String> {
    let conn = state
        .0
        .lock()
        .map_err(|e| format!("获取数据库连接失败: {e}"))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO contexts (type, role, content, token_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            args.r#type,
            args.role,
            args.content,
            args.token_count.unwrap_or(0),
            now
        ],
    )
    .map_err(|e| format!("写入 context 失败: {e}"))?;
    Ok(conn.last_insert_rowid() as u64)
}

/// 分页读取 context 列表 (默认按 id 倒序, 最新的在前)
/// invoke("context_list", { args: { limit: 50, offset: 0 } })
#[tauri::command]
pub fn context_list(
    state: tauri::State<'_, db::Db>,
    args: ContextListArgs,
) -> Result<Vec<ContextRecord>, String> {
    let conn = state
        .0
        .lock()
        .map_err(|e| format!("获取数据库连接失败: {e}"))?;
    let limit = args.limit.unwrap_or(100).min(1000);
    let offset = args.offset.unwrap_or(0);
    let mut stmt = conn
        .prepare(
            "SELECT id, type, role, content, token_count, created_at
             FROM contexts
             ORDER BY id DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| format!("查询 context 失败: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![limit, offset], |row| {
            Ok(ContextRecord {
                id: row.get(0)?,
                r#type: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                token_count: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("读取 context 失败: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("解析 context 失败: {e}"))?;
    Ok(rows)
}

/// 插入参数 (与前端保持 camelCase)
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInsertArgs {
    /// 类型: talk / tts 等
    pub r#type: String,
    /// 角色: user / assistant 等
    #[serde(default)]
    pub role: Option<String>,
    /// 内容
    pub content: String,
    /// token 数 (可选)
    #[serde(default)]
    pub token_count: Option<u64>,
}

/// 列表参数
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextListArgs {
    /// 返回条数 (默认 100)
    #[serde(default)]
    pub limit: Option<u32>,
    /// 偏移
    #[serde(default)]
    pub offset: Option<u32>,
}

/// context 记录 (返回给前端)
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRecord {
    pub id: u64,
    pub r#type: String,
    pub role: Option<String>,
    pub content: String,
    pub token_count: u64,
    pub created_at: i64,
}
