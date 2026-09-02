//! 数据库升级 / 旧版本兼容 (集中管理)
//!
//! 已发布版本后, 对**已有表**的结构变更不能只改 `db.rs` 的 SCHEMA
//! (CREATE TABLE IF NOT EXISTS 不会改动已存在的旧表), 必须在这里补一步幂等升级.
//! `db::init` 建表后会统一调用 [`run`], 之后不要再把升级逻辑散落到各业务模块.
//!
//! 约定:
//! - 每个步骤都是幂等守卫 (先检查再变更), 每次启动重复执行都安全, 不依赖 user_version 记录;
//! - 新表直接写进 `db.rs` SCHEMA (建表自动覆盖新库), 只有旧表加列/改结构才需要来这里;
//! - 新增升级步骤: 在 [`run`] 末尾追加一行, 例如
//!   `ensure_column(conn, "tools", "foo", "TEXT NOT NULL DEFAULT ''")?;`

use rusqlite::Connection;

/// 执行全部数据库升级步骤 (幂等; 按发布版本从旧到新排列)
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
	// v0.3.x: tools 表新增 keywords 列 (搜索别名, 前端工具页可编辑)
	ensure_column(conn, "tools", "keywords", "TEXT NOT NULL DEFAULT ''")?;
	Ok(())
}

/// 检查表是否已含某列, 缺失时补列 (幂等)
///
/// `table` / `column` / `ddl` 只允许来自代码内的固定标识符, 不做外部输入.
fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> rusqlite::Result<()> {
	let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
	let columns = stmt
		.query_map([], |row| row.get::<_, String>(1))?
		.collect::<Result<Vec<_>, _>>()?;
	if columns.iter().any(|name| name == column) {
		return Ok(());
	}
	conn.execute(
		&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"),
		[],
	)?;
	Ok(())
}
