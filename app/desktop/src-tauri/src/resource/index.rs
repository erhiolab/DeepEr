//! 资源索引表
//!
//! 资源元信息 (id / 来源 / 入口文件 / 大小) 存入 SQLite `resources` 表,
//! 列表查询直接从 DB 读, 避免每次打开模型页都遍历磁盘文件夹 + 递归统计大小.
//!
//! 安装 (ensure_resource)、导入 (import_live2d) 成功后会调用 [`upsert`] 写入/更新索引,
//! 删除资源后调用 [`remove`] 清理. 应用启动时通过 [`reconcile`] 做一次磁盘 ⇄ DB 校准.

use rusqlite::{params, Connection};
use std::path::Path;

use crate::resource::types::ResourceType;
use crate::resource::{self, live2d};

/// 已索引资源 (从 DB 读出的元数据, 与磁盘目录一一对应)
#[derive(Debug, Clone)]
pub struct IndexedResource {
    pub name: String,
    pub is_official: bool,
    pub entry_file: Option<String>,
    pub size: u64,
}

/// 写入或更新一条资源索引
/// 安装 / 导入成功后调用, 会刷新大小与入口文件、更新来源.
pub fn upsert(
    conn: &Connection,
    resource_type: ResourceType,
    name: &str,
    is_official: bool,
    entry_file: Option<&str>,
    size: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT INTO resources (id, resource_type, is_official, entry_file, size, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            resource_type = excluded.resource_type,
            is_official = excluded.is_official,
            entry_file = excluded.entry_file,
            size = excluded.size
        "#,
        params![
            name,
            resource_type.as_str(),
            if is_official { 1 } else { 0 },
            entry_file,
            size as i64,
        ],
    )?;
    Ok(())
}

/// 仅当索引不存在时插入 (不覆盖已有记录)
/// reconcile 补录用: 保留已存在记录原本的来源标记, 避免把官方模型误判为用户导入.
pub fn insert_if_missing(
    conn: &Connection,
    resource_type: ResourceType,
    name: &str,
    is_official: bool,
    entry_file: Option<&str>,
    size: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        r#"
        INSERT OR IGNORE INTO resources (id, resource_type, is_official, entry_file, size, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
        "#,
        params![
            name,
            resource_type.as_str(),
            if is_official { 1 } else { 0 },
            entry_file,
            size as i64,
        ],
    )?;
    Ok(())
}

/// 删除一条资源索引
pub fn remove(conn: &Connection, resource_type: ResourceType, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM resources WHERE id = ?1 AND resource_type = ?2",
        params![name, resource_type.as_str()],
    )?;
    Ok(())
}

/// 查询指定类型的所有已索引资源 (直接读 DB, 不触碰磁盘)
pub fn list(conn: &Connection, resource_type: ResourceType) -> rusqlite::Result<Vec<IndexedResource>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT id, is_official, entry_file, size
        FROM resources
        WHERE resource_type = ?1
        ORDER BY id
        "#,
    )?;
    let rows = stmt.query_map(params![resource_type.as_str()], |row| {
        Ok(IndexedResource {
            name: row.get(0)?,
            is_official: row.get::<_, i64>(1)? != 0,
            entry_file: row.get(2)?,
            size: row.get::<_, i64>(3)? as u64,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// 检查资源是否已被索引
#[allow(dead_code)]
pub fn contains(conn: &Connection, resource_type: ResourceType, name: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM resources WHERE id = ?1 AND resource_type = ?2",
        params![name, resource_type.as_str()],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// 启动时校准磁盘与索引表:
/// - 磁盘上存在 (有效 Live2D 模型) 但 DB 没有 → 补录 (不覆盖已有记录, 保留原有来源标记)
/// - DB 有但磁盘目录已不存在 / 已失效 → 删除索引
///
/// 只应在应用 setup 阶段调用一次, 不要在打开模型页时调用.
pub fn reconcile(conn: &Connection, data_dir: &Path) {
    let root = data_dir.join(resource::RESOURCES_DIR).join(ResourceType::Live2D.dir_name());
    let mut disk_names: Vec<String> = Vec::new();

    if root.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                // 只有含有效入口文件的目录才算已安装模型
                if let Some(entry_file) = live2d::find_entry_file(&path) {
                    // 补录: 仅当该模型此前未被索引时插入, 已有记录保留其来源标记 (官方/导入)
                    let _ = insert_if_missing(
                        conn,
                        ResourceType::Live2D,
                        name,
                        false,
                        Some(&entry_file),
                        resource::calculate_dir_size(&path).unwrap_or(0),
                    );
                    disk_names.push(name.to_string());
                }
            }
        }
    }

    // 删除 DB 中有、但磁盘上已不存在/已失效的索引
    if let Ok(indexed) = list(conn, ResourceType::Live2D) {
        for item in indexed {
            if !disk_names.contains(&item.name) {
                let _ = remove(conn, ResourceType::Live2D, &item.name);
            }
        }
    }
}
