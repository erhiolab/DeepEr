//! 应用更新 (Agent 工具用)
//!
//! 与前端 updater store 同一套 tauri-plugin-updater, 供 Agent 检查 / 更新应用.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

/// 检查更新: 返回当前版本 / 最新版本 / 是否有更新 / 更新说明
pub async fn check_update(app: &AppHandle) -> Result<Value, String> {
	let current = app.package_info().version.to_string();
	let updater = app.updater().map_err(|e| format!("获取更新器失败: {e}"))?;
	match updater.check().await {
		Ok(Some(update)) => Ok(json!({
			"hasUpdate": true,
			"currentVersion": current,
			"latestVersion": update.version,
			"notes": update.body.unwrap_or_default(),
		})),
		Ok(None) => Ok(json!({ "hasUpdate": false, "currentVersion": current })),
		Err(e) => Err(format!("检查更新失败: {e}")),
	}
}

/// 下载安装最新版并重启应用 (调用前必须先取得用户同意)
pub async fn apply_update(app: &AppHandle) -> Result<Value, String> {
	let updater = app.updater().map_err(|e| format!("获取更新器失败: {e}"))?;
	let update = updater
		.check()
		.await
		.map_err(|e| format!("检查更新失败: {e}"))?
		.ok_or_else(|| "没有可用更新".to_string())?;
	update
		.download_and_install(|_, _| {}, || {})
		.await
		.map_err(|e| format!("下载安装失败: {e}"))?;
	// 重启应用使更新生效 (不返回)
	app.restart();
}
