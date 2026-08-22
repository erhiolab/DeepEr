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
    /// 模型名称 (显示用, 用于模型列表等界面展示)
    /// 缺失或为空时, 界面回落显示模型目录名 (id); 可随时修改
    #[serde(default)]
    pub name: String,
    /// 模型展示图标 (相对模型目录的图片路径, 任意图片格式)
    /// 例如 "哼.gif"; 用于模型列表封面展示, 缺失/加载失败时前端回落占位图标
    #[serde(default)]
    pub image: String,
    /// 渲染配置
    #[serde(default)]
    pub render: ModelRenderConfig,
    /// 显示质量 (渲染倍率), 范围 0.25 ~ 1.0
    /// 1.0 为原始输出分辨率 (跟随设备像素比), 越小渲染分辨率越低, 越节省 GPU/内存
    /// 低性能设备可调低该值以避免卡顿, 画面会相应变得模糊
    #[serde(default = "default_quality")]
    pub quality: f64,
    /// 自定义可触摸区域
    #[serde(default)]
    pub touches: Vec<TouchArea>,
}

/// 默认显示质量
fn default_quality() -> f64 {
    1.0
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            name: String::new(),
            image: String::new(),
            render: ModelRenderConfig::default(),
            quality: default_quality(),
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

/// 判断目标目录是否已经存在且包含有效入口
fn target_exists_with_entry(target: &Path) -> bool {
    target.is_dir() && find_entry_in_dir(target).is_some()
}

/// 从"已就绪的可导入路径"导入 Live2D 模型并平铺到 `resources/live2d/<模型名>/`.
///
/// 这是文件夹 / zip / 单个入口 json 三种导入方式共用的落盘逻辑:
/// 1. 在 `source_root` 中递归定位入口文件 (`.model3.json` / `.model.json`);
/// 2. 以入口文件所在的目录为「模型资产根」(可能比 `source_root` 深一层, 抹平外层包装目录),
///    把该目录的全部内容复制到目标, 资产引用所需的子目录 (textures / motions 等) 原样保留;
/// 3. 入口文件统一重命名为 `model3.json` / `model.json` 平铺在目标根下 —— 满足
///    `resources/live2d/<模型名>/model3.json` 且不产生不必要的文件夹嵌套;
/// 4. 模型名取入口文件名去掉 `.model3` / `.model` 与 `.json` 后的词干.
pub fn import_from_dir<F>(
    data_dir: &Path,
    source_root: &Path,
    progress_callback: F,
) -> Result<ResourceInfo, String>
where
    F: Fn(u64, u64),
{
    if !source_root.is_dir() {
        return Err("导入路径不是目录".to_string());
    }
    // 定位入口文件 (相对 source_root, 可能位于子层)
    let entry_rel = find_entry_file(source_root)
        .ok_or_else(|| "所选内容缺少 .model.json 或 .model3.json, 无法导入".to_string())?;
    let entry_path = Path::new(&entry_rel);
    let entry_file_name = entry_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法识别入口文件名称".to_string())?;

    // 模型资产根: 入口文件所在的目录 (相对 source_root)
    let parent_rel = entry_path.parent().unwrap_or_else(|| Path::new(""));
    let model_root = if parent_rel.as_os_str().is_empty() {
        source_root.to_path_buf()
    } else {
        source_root.join(parent_rel)
    };

    // 归一化入口名与模型名
    // - 字面量命名 (model.json / model3.json, 无模型名前缀): 标准名即它自身, 模型名取模型根目录名
    // - 带前缀命名 (xxx.model3.json / xxx.model.json): 标准名为 model3.json/model.json, 模型名取文件名词干
    let lower = entry_file_name.to_ascii_lowercase();
    let (std_entry_name, name) = if lower.eq("model3.json") || lower.eq("model.json") {
        let std = if lower.eq("model3.json") { "model3.json" } else { "model.json" };
        // 字面量入口: 模型名取模型根目录名 (无模型名前缀可剥离)
        (std, dir_file_name(&model_root).unwrap_or_else(|| "live2d_model".to_string()))
    } else if lower.ends_with(".model3.json") {
        ("model3.json", entry_file_name[..entry_file_name.len() - ".model3.json".len()].to_string())
    } else if lower.ends_with(".model.json") {
        ("model.json", entry_file_name[..entry_file_name.len() - ".model.json".len()].to_string())
    } else {
        return Err("无法识别的 Live2D 入口文件".to_string());
    };

    validate_resource_name(&name)?;

    // 目标目录, 已存在则追加序号避免覆盖
    let target_root = root_dir(data_dir);
    fs::create_dir_all(&target_root).map_err(|e| format!("创建 Live2D 资源目录失败: {e}"))?;
    let mut final_name = name.clone();
    let mut target = target_root.join(&final_name);
    let mut index = 2;
    while target_exists_with_entry(&target) {
        final_name = format!("{name}-{index}");
        target = target_root.join(&final_name);
        index += 1;
    }

    // 总大小 (用于进度)
    let total = calculate_dir_size(&model_root).unwrap_or(0);

    // 先完整复制模型资产根到目标 (保留相对结构)
    let mut copied = 0u64;
    if let Err(e) = copy_dir_progress(&model_root, &target, total, &mut copied, &progress_callback) {
        // 复制失败时清理半成品, 避免残留无入口目录被下次导入复用
        let _ = fs::remove_dir_all(&target);
        return Err(format!("导入失败: {e}"));
    }

    // 把入口文件重命名归一为 model3.json / model.json, 平铺到目标根
    // 注意: 复制的是入口所在目录 (model_root) 的内容到 target, 故入口一定位于 target 根,
    // 不能用相对 source_root 的 entry_rel (含外层目录前缀, 套层时会指向不存在的路径)
    let entry_actual = target.join(entry_file_name);
    let std_target = target.join(std_entry_name);
    if entry_actual != std_target {
        if std_target.exists() {
            std::fs::remove_file(&std_target).ok();
        }
        if let Err(e) = std::fs::rename(&entry_actual, &std_target) {
            // 重命名失败时删除已复制的目标, 避免留下孤立模型目录
            let _ = fs::remove_dir_all(&target);
            return Err(format!("归一化入口文件失败: {e}"));
        }
    }
    // 清理入口原所在目录留下的空父链
    if let Some(parent) = entry_actual.parent() {
        remove_empty_parents(parent, &target);
    }

    // 校验
    if !exists(data_dir, &final_name) {
        let _ = fs::remove_dir_all(&target);
        return Err("导入后校验失败: 缺少入口文件".to_string());
    }
    let size = calculate_dir_size(&target).unwrap_or(total);
    Ok(ResourceInfo {
        name: final_name,
        resource_type: ResourceType::Live2D,
        path: target,
        size,
        entry_file: Some(std_entry_name.to_string()),
    })
}

/// 取路径最后一级目录名 (纯文件名辅助), 失败时返回 None
fn dir_file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

/// 从 `dir` 向 `stop` 方向逐级删除空目录 (处理入口归一化后遗留的空父链)
fn remove_empty_parents(mut dir: &Path, stop: &Path) {
    loop {
        let Ok(metadata) = fs::metadata(dir) else {
            return;
        };
        if !metadata.is_dir() {
            return;
        }
        if dir.starts_with(stop) && dir != stop {
            let _ = fs::remove_dir(dir);
        } else {
            break;
        }
        let Some(parent) = dir.parent() else {
            break;
        };
        dir = parent;
    }
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

/// 将一张图片复制进模型目录作为模型封面, 返回相对模型目录的路径
/// 目标文件名为 `cover.<ext>`, 会覆盖同目录下已有的 cover 文件
/// 校验: 源文件必须存在且为目标目录之外的文件, 目标目录必须是合法模型目录
pub fn save_model_image(
    data_dir: &Path,
    name: &str,
    source_path: &Path,
) -> Result<String, String> {
    let resource_dir = model_dir(data_dir, name)?;
    if !resource_dir.is_dir() {
        return Err(format!("Live2D 资源不存在: {name}"));
    }
    let root = root_dir(data_dir);
    ensure_inside(&root, &resource_dir)?;
    if !source_path.is_file() {
        return Err(format!("所选文件不存在: {}", source_path.display()));
    }
    // 只允许常见图片扩展名
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"))
        .ok_or_else(|| "仅支持 png/jpg/gif/webp/bmp 图片".to_string())?;
    let target = resource_dir.join(format!("cover.{ext}"));
    // 覆盖旧封面 (其他扩展名) 避免残留
    for old in ["cover.png", "cover.jpg", "cover.jpeg", "cover.gif", "cover.webp", "cover.bmp"] {
        if old != target.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default() {
            let old_path = resource_dir.join(old);
            if old_path.is_file() {
                let _ = fs::remove_file(&old_path);
            }
        }
    }
    fs::copy(source_path, &target).map_err(|e| format!("复制图片失败: {e}"))?;
    Ok(format!(
        "cover.{}",
        target.extension().and_then(|e| e.to_str()).unwrap_or(&ext)
    ))
}
