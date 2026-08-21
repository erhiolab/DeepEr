//! 资源管理模块: Live2D 模型
//! 同时支持 Cubism2 (`.model.json`) 与 Cubism3 (`.model3.json`)

use crate::resource::types::{ResourceInfo, ResourceType};
use crate::resource::{calculate_dir_size, validate_resource_name, RESOURCES_DIR};

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 模型级配置文件 (位于模型目录下, 随模型一起存在/删除/导入导出)
/// 保存渲染配置与用户自定义可触摸区域, 数据库不再保存模型渲染信息
pub const MODEL_CONFIG_FILE: &str = "model.config.json";

/// 渲染配置 (原本在数据库 config 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRenderConfig {
    /// 模型缩放比例, 1 为原始大小
    #[serde(default = "default_scale")]
    pub scale: f64,
    /// X 轴偏移 -2 ~ 2
    #[serde(default)]
    pub pos_x: f64,
    /// Y 轴偏移 -2 ~ 2
    #[serde(default)]
    pub pos_y: f64,
}

impl Default for ModelRenderConfig {
    fn default() -> Self {
        Self {
            scale: default_scale(),
            pos_x: 0.0,
            pos_y: 0.0,
        }
    }
}

fn default_scale() -> f64 {
    1.0
}

fn default_touch_type() -> String {
    "tap".to_string()
}

fn default_version() -> i64 {
    1
}

/// 用户自定义可触摸区域
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchArea {
    /// 唯一 id (生成后不变, 用于增删改)
    pub id: String,
    /// 用户命名 (显示与回调用)
    pub name: String,
    /// 触摸类型: tap=点击 / swipe=磨蹭
    #[serde(default = "default_touch_type")]
    pub r#type: String,
    /// 归一化区域 (0~1, 相对模型画布)
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    /// 该区域展示/图标图片地址
    #[serde(default)]
    pub image: String,
    /// 触发回调时携带的描述, 供 AI 理解
    #[serde(default)]
    pub prompt: String,
}

/// 模型级配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    /// 配置结构版本, 不兼容变更时 +1 用于迁移
    #[serde(default = "default_version")]
    pub version: i64,
    /// 渲染配置
    #[serde(default)]
    pub render: ModelRenderConfig,
    /// 自定义可触摸区域
    #[serde(default)]
    pub touches: Vec<TouchArea>,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            render: ModelRenderConfig::default(),
            touches: Vec::new(),
        }
    }
}


/// Live2D 资源根目录
fn root_dir(data_dir: &Path) -> PathBuf {
    data_dir
        .join(RESOURCES_DIR)
        .join(ResourceType::Live2D.dir_name())
}

/// 获取指定 Live2D 模型目录 (物理路径)
fn model_dir(data_dir: &Path, name: &str) -> Result<PathBuf, String> {
    validate_resource_name(name)?;
    Ok(root_dir(data_dir).join(name))
}

/// 检查 Live2D 模型是否已经安装
/// 只要目录里能找到 Cubism2 / Cubism3 入口文件即视为已安装
pub fn exists(data_dir: &Path, name: &str) -> bool {
    let Ok(resource_dir) = model_dir(data_dir, name) else {
        return false;
    };
    resource_dir.is_dir() && find_entry_file(&resource_dir).is_some()
}

/// 获取指定 Live2D 模型的信息
pub fn get(data_dir: &Path, name: &str) -> Result<ResourceInfo, String> {
    let resource_dir = model_dir(data_dir, name)?;
    if !resource_dir.is_dir() {
        return Err(format!("Live2D 资源不存在: {name}"));
    }
    let entry = find_entry_file(&resource_dir)
        .ok_or_else(|| format!("Live2D 资源无效, 缺少 .model.json 或 .model3.json: {name}"))?;
    let size = calculate_dir_size(&resource_dir)
        .map_err(|e| format!("计算 Live2D 资源大小失败: {e}"))?;
    Ok(ResourceInfo {
        name: name.to_string(),
        resource_type: ResourceType::Live2D,
        path: resource_dir,
        size,
        entry_file: Some(entry),
    })
}

/// 删除指定 Live2D 模型
/// 1. 验证模型名称
/// 2. 确保目标路径位于 Live2D 根目录
/// 3. 确认资源存在
pub fn delete(data_dir: &Path, name: &str) -> Result<(), String> {
    let resource_dir = model_dir(data_dir, name)?;
    let root = root_dir(data_dir);
    ensure_inside(&root, &resource_dir)?;
    if !resource_dir.exists() {
        return Err(format!("Live2D 资源不存在: {name}"));
    }
    if !resource_dir.is_dir() {
        return Err(format!("Live2D 资源路径不是目录: {name}"));
    }
    fs::remove_dir_all(&resource_dir).map_err(|e| format!("删除 Live2D 资源失败: {e}"))?;
    Ok(())
}

/// 在模型目录中查找入口文件
/// 返回入口文件相对模型目录的路径 (如 `arg-nori.model3.json`), 不含所在目录名
/// 优先 Cubism3 (`.model3.json`), 其次 Cubism2 (`.model.json`)
/// 入口文件可能位于子目录中, 因此会递归查找
pub fn find_entry_file(model_root: &Path) -> Option<String> {
    if !model_root.is_dir() {
        return None;
    }
    // 收集所有候选入口文件
    let mut models = Vec::new();
    let mut c2 = Vec::new();
    let mut c3 = Vec::new();
    collect_entry_files(model_root, model_root, &mut c2, &mut c3, &mut models);
    // 优先级: model3.json > model.json
    c3.first()
        .or_else(|| c2.first())
        .or_else(|| models.first())
        .map(|rel| rel.replace('\\', "/"))
}

/// 递归收集模型入口文件
/// - c3: `.model3.json` 结尾
/// - c2: `.model.json` 结尾 (排除 `.model3.json`)
/// - models: 其他 (兜底, 如 `model.json`/`model3.json` 不严格以 .model 开头的命名)
fn collect_entry_files(
    dir: &Path,
    model_root: &Path,
    c2: &mut Vec<String>,
    c3: &mut Vec<String>,
    models: &mut Vec<String>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_entry_files(&path, model_root, c2, c3, models);
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = file_name.to_ascii_lowercase();
        if !lower.ends_with(".json") {
            continue;
        }
        // 只认标准的 Live2D 入口命名
        let rel = path
            .strip_prefix(model_root)
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        let rel = match rel {
            Some(r) => r,
            None => continue,
        };
        if lower.ends_with(".model3.json") {
            c3.push(rel);
        } else if lower.ends_with(".model.json") {
            c2.push(rel);
        } else if lower == "model3.json" || lower == "model.json" {
            models.push(rel);
        }
    }
}

/// 校验一个目录是否包含合法的 Live2D 模型入口
/// 返回入口文件相对源目录的路径, 供导入 / 校验使用
pub fn find_entry_in_dir(dir: &Path) -> Option<String> {
    find_entry_file(dir)
}

/// 导入 Live2D 模型
/// 把 `source_dir` 的模型复制一份到 data 的 resources/live2d/<id> 目录
/// 校验源目录含 `.model.json` / `.model3.json`; 目标已存在时返回错误
/// `progress_callback(total, copied)` 用于向外部推送复制进度 (字节)
pub fn import<F>(
    data_dir: &Path,
    source_dir: &Path,
    progress_callback: F,
) -> Result<ResourceInfo, String>
where
    F: Fn(u64, u64),
{
    // 校验源目录
    if !source_dir.is_dir() {
        return Err("导入路径不是目录".to_string());
    }
    let entry = find_entry_in_dir(source_dir)
        .ok_or_else(|| "所选目录缺少 .model.json 或 .model3.json, 无法导入".to_string())?;

    // 模型 id 取源目录名 (含安全校验)
    let source_name = source_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("live2d_model");
    validate_resource_name(source_name)?;
    let mut name = source_name.to_string();
    // 若 id 已存在, 追加序号避免覆盖
    let target_root = root_dir(data_dir);
    fs::create_dir_all(&target_root)
        .map_err(|e| format!("创建 Live2D 资源目录失败: {e}"))?;
    let mut target = target_root.join(&name);
    let mut index = 2;
    while target_exists_with_entry(&target) {
        name = format!("{source_name}-{index}");
        target = target_root.join(&name);
        index += 1;
    }

    // 统计待复制总大小
    let total = calculate_dir_size(source_dir).unwrap_or(0);

    // 复制 (带进度)
    let mut copied = 0u64;
    copy_dir_progress(source_dir, &target, total, &mut copied, &progress_callback)
        .map_err(|e| format!("导入失败: {e}"))?;
    progress_callback(total, total);

    // 校验
    if !exists(data_dir, &name) {
        let _ = fs::remove_dir_all(&target);
        return Err("导入后校验失败: 复制结果缺少入口文件".to_string());
    }
    Ok(ResourceInfo {
        name,
        resource_type: ResourceType::Live2D,
        path: target,
        size: total,
        entry_file: Some(entry),
    })
}

/// 判断目标目录是否已经存在且包含有效入口
fn target_exists_with_entry(target: &Path) -> bool {
    target.is_dir() && find_entry_in_dir(target).is_some()
}

/// 带进度回调递归复制目录
/// `progress_callback(total, copied)` 以字节为单位
fn copy_dir_progress<F>(
    src: &Path,
    dst: &Path,
    total: u64,
    copied: &mut u64,
    progress_callback: &F,
) -> Result<(), std::io::Error>
where
    F: Fn(u64, u64),
{
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_progress(&from, &to, total, copied, progress_callback)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)?;
            *copied = copied.saturating_add(entry.metadata()?.len());
            progress_callback(total, *copied);
        }
        // 符号链接等其他类型忽略
    }
    Ok(())
}

/// 确保目标路径位于 root 目录里面
fn ensure_inside(root: &Path, target: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| format!("解析资源根目录失败: {e}"))?;
    // target 可能不存在, 因此不能直接 canonicalize target
    let parent = target
        .parent()
        .ok_or_else(|| "资源路径没有父目录".to_string())?;
    let parent = fs::canonicalize(parent).map_err(|e| format!("解析资源父目录失败: {e}"))?;
    if !parent.starts_with(&root) {
        return Err("资源路径超出资源目录范围".to_string());
    }
    Ok(())
}

/// 模型级配置文件路径: <model_dir>/model.config.json
pub fn model_config_path(data_dir: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(model_dir(data_dir, name)?.join(MODEL_CONFIG_FILE))
}

/// 读取模型级配置, 文件缺失时返回默认配置 (不报错)
pub fn read_model_config(data_dir: &Path, name: &str) -> Result<ModelConfig, String> {
    let path = model_config_path(data_dir, name)?;
    if !path.is_file() {
        return Ok(ModelConfig::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("读取模型配置失败: {}: {e}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("解析模型配置失败: {}: {e}", path.display()))
}

/// 写入模型级配置 (自动创建父目录, 覆盖式写入)
pub fn write_model_config(
    data_dir: &Path,
    name: &str,
    config: &ModelConfig,
) -> Result<(), String> {
    let resource_dir = model_dir(data_dir, name)?;
    if !resource_dir.is_dir() {
        return Err(format!("Live2D 资源不存在: {name}"));
    }
    let path = resource_dir.join(MODEL_CONFIG_FILE);
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化模型配置失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("写入模型配置失败: {}: {e}", path.display()))
}
