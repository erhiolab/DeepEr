//! 资源模块

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::http::{header, Response, StatusCode};
use tauri::UriSchemeContext;
use tauri::Wry;

/// 自定义协议名称
pub const SCHEME: &str = "deeper-asset";

/// 处理 <SCHEME>:// 请求
pub fn handle(
    ctx: &UriSchemeContext<'_, Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let raw_path = request.uri().path();
    // URL 路径解码
    let decoded = match percent_decode(raw_path) {
        Some(value) => value,
        None => {
            return bad_request("URL 路径编码非法");
        }
    };
    let relative = decoded.trim_start_matches('/');
    if relative.is_empty() {
        return not_found("空路径");
    }
    // 路径安全检查
    if !is_safe_relative_path(relative) {
        return forbidden("非法资源路径");
    }
    // 临时合成音频: 请求路径形如 `tts/tts_xxx.wav`, 实际存于 <app_data>/temp/tts
    // (见 commands/tts.rs 的缓存目录). 这类临时产物不在 resources 内, 需单独映射到 temp 目录.
    if let Some(sub) = relative.strip_prefix("tts/") {
        return serve_tts_asset(ctx.app_handle(), sub);
    }
    // 获取资源根目录 (data/resources, 所有下载资源存放于此)
    let data_root = match crate::resource::resources_dir(ctx.app_handle()) {
        Ok(path) => path,
        Err(error) => {
            let _ = error;
            return internal_error("资源目录不可用");
        }
    };
    // data 目录本身不存在时直接返回 404
    if !data_root.exists() {
        return not_found("data 目录不存在");
    }
    // canonicalize data root
    let data_root = match data_root.canonicalize() {
        Ok(path) => path,
        Err(_) => {
            return internal_error("data 目录不可用");
        }
    };
    // 构造候选路径
    for candidate in path_candidates(relative) {
        let candidate_path = data_root.join(&candidate);
        let file_path = match candidate_path.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        // 防止路径穿越 / symlink 逃逸
        if !file_path.starts_with(&data_root) {
            continue;
        }
        // 只允许文件
        if !file_path.is_file() {
            continue;
        }
        return serve_file(&file_path, &candidate);
    }
    // model3.json 文件名可能与模型目录名不一致 (例如目录 arg-nori 内是 ARGNori.model3.json).
    // live2d 客户端会请求 `<modelDir>.model3.json`, 常规候选无法命中时, 按 `.model3.json` 后缀在模型目录下查找真实文件.
    if let Some((file_path, logical)) = find_model3_by_suffix(&data_root, relative) {
        return serve_file(&file_path, &logical);
    }
    not_found(&format!("资源不存在: {}", relative))
}

/// 响应 `tts/...` 临时合成音频请求: 从 <app_data>/temp/tts 读取.
/// 由 `tts_synthesize` 写入, 且会定期被 prune_cache 清理, 属于临时产物.
fn serve_tts_asset(app: &tauri::AppHandle, sub: &str) -> Response<Cow<'static, [u8]>> {
    let root = match crate::resource::temp_dir(app) {
        Ok(path) => path.join("tts"),
        Err(_) => return internal_error("临时目录不可用"),
    };
    let canonical_root = match root.canonicalize() {
        Ok(path) => path,
        Err(_) => return not_found("临时目录不存在"),
    };
    for candidate in path_candidates(sub) {
        let candidate_path = canonical_root.join(&candidate);
        let file_path = match candidate_path.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        // 防止路径穿越 / symlink 逃逸
        if !file_path.starts_with(&canonical_root) {
            continue;
        }
        if !file_path.is_file() {
            continue;
        }
        return serve_file(&file_path, &candidate);
    }
    not_found(&format!("资源不存在: {}", sub))
}

/// 判断 URL 解码后的路径是否为安全的相对路径
fn is_safe_relative_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    // Unix absolute path
    if path.starts_with('/') {
        return false;
    }
    // Windows / UNC absolute path
    if path.starts_with('\\') {
        return false;
    }
    // Windows:
    //
    // C:\foo
    // C:/foo
    //
    if is_windows_absolute_path(path) {
        return false;
    }
    // 分隔符统一
    for segment in path.split(['/', '\\']) {
        if segment.is_empty() {
            continue;
        }
        if segment == ".." {
            return false;
        }
        if segment == "." {
            return false;
        }
    }
    true
}

/// 判断 Windows 风格绝对路径
fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    // C:\xxx
    // C:/xxx
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return true;
    }
    false
}

/// 生成资源路径候选
fn path_candidates(path: &str) -> Vec<String> {
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() < 3 {
        return vec![path.to_string()];
    }
    let mut candidates = Vec::with_capacity(segments.len());
    // 原始路径优先
    candidates.push(segments.join("/"));
    // 从第二层开始尝试删除一个目录
    // live2d/arg-nori/arg-nori/model.json
    // → live2d/arg-nori/model.json
    for index in 1..segments.len() {
        let mut candidate = Vec::with_capacity(segments.len() - 1);
        for (i, segment) in segments.iter().enumerate() {
            if i != index {
                candidate.push(*segment);
            }
        }
        candidates.push(candidate.join("/"));
    }
    candidates
}

/// 当 `.model3.json` 请求按普通路径无法命中时, 按文件后缀在模型目录下兜底查找真实文件.
///
/// live2d 客户端把请求固定命名为 `<modelDir>.model3.json` (例如 `arg-nori.model3.json`),
/// 但磁盘真实文件可能是其它名字 (例如 `ARGNori.model3.json`), 普通候选匹配不到.
/// 优先匹配与模型名(去分隔符, 大小写不敏感)一致的候选, 再退回任意匹配.
fn find_model3_by_suffix(data_root: &Path, relative: &str) -> Option<(PathBuf, String)> {
    let rel_lower = relative.to_ascii_lowercase();
    if !rel_lower.ends_with(".model3.json") {
        return None;
    }
    let segments: Vec<&str> = relative.split('/').filter(|s| !s.is_empty()).collect();
    // 需要至少两段: <资源类型>/<模型名>/...
    if segments.len() < 2 {
        return None;
    }
    // 模型目录根 = <资源类型>/<模型名>
    let model_root = data_root.join(segments[0]).join(segments[1]);
    let canonical_root = model_root.canonicalize().ok()?;
    // 防止路径穿越 / symlink 逃逸
    if !canonical_root.starts_with(data_root) {
        return None;
    }
    // 优先匹配与模型名一致的候选 (例如模型 arg-nori 在目录内是 arg-nori.model3.json)
    let model_key = segments[1].replace(['-', '_', ' ', '.'], "").to_ascii_lowercase();
    if !model_key.is_empty() {
        if let Some(collated) = match_collated_model3(&canonical_root, &model_key) {
            return Some((collated, relative.to_string()));
        }
    }
    // 回退: 任意 .model3.json (递归, 浅层优先)
    let found = find_first_model3_file(&canonical_root)?;
    Some((found, relative.to_string()))
}

/// 在目录的直接子文件中查找文件名(去分隔符后, 大小写不敏感)与给定 key 一致的 `.model3.json`.
fn match_collated_model3(dir: &Path, model_key: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.to_ascii_lowercase().ends_with(".model3.json") {
            continue;
        }
        let base = file_name
            .replace(".model3.json", "")
            .replace(['-', '_', ' ', '.'], "")
            .to_ascii_lowercase();
        if base == model_key {
            return Some(path);
        }
    }
    None
}

/// 在目录下递归查找第一个 `.model3.json` 文件 (浅层优先).
fn find_first_model3_file(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            dirs.push(path);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if file_name.to_ascii_lowercase().ends_with(".model3.json") {
            return Some(path);
        }
    }
    // 递归子目录
    for d in dirs {
        if let Some(found) = find_first_model3_file(&d) {
            return Some(found);
        }
    }
    None
}

/// 读取文件并返回 HTTP Response
fn serve_file(file_path: &Path, logical_path: &str) -> Response<Cow<'static, [u8]>> {
    let bytes = match fs::read(file_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return not_found(&format!("读取资源失败: {}", logical_path));
        }
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for(logical_path))
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "public, max-age=3600")
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| internal_error("构造资源响应失败"))
}

/// Percent Decode
/// 如果发现 `%` 后面不是合法 HEX, 则返回 None
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex_value(bytes[index + 1])?;
            let low = hex_value(bytes[index + 2])?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

/// HEX 字符
fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// 根据文件扩展名返回 MIME
fn mime_for(path: &str) -> &'static str {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match extension.as_deref() {
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("moc3") => "application/octet-stream",
        Some("motion3") => "application/json; charset=utf-8",
        Some("physics3") => "application/json; charset=utf-8",
        Some("exp3") => "application/json; charset=utf-8",
        Some("zip") => "application/zip",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// 构造 HTTP Response
fn response(
    status: StatusCode,
    content_type: &'static str,
    message: &str,
) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(message.as_bytes().to_vec()))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(&b""[..])))
}

/// 构造 HTTP Response
fn bad_request(message: &str) -> Response<Cow<'static, [u8]>> {
    response(
        StatusCode::BAD_REQUEST,
        "text/plain; charset=utf-8",
        message,
    )
}

/// 构造 HTTP Response
fn forbidden(message: &str) -> Response<Cow<'static, [u8]>> {
    response(StatusCode::FORBIDDEN, "text/plain; charset=utf-8", message)
}

/// 构造 HTTP Response
fn not_found(message: &str) -> Response<Cow<'static, [u8]>> {
    response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", message)
}

/// 构造 HTTP Response
fn internal_error(message: &str) -> Response<Cow<'static, [u8]>> {
    response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "text/plain; charset=utf-8",
        message,
    )
}
