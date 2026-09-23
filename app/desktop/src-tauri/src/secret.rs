//! 敏感配置加解密模块
//! AES-256-GCM 加密
//! - 主密钥 (32 字节) 首次运行时生成, 保存在应用数据目录下的 `secret.key` 文件中
//! - 前端提交明文 `apiKey` → 后端 `secret_encrypt` 加密为密文 → 密文入库
//!   读取时前端从库中取密文 → 后端 `secret_decrypt` 解密 → 内存中使用
//! - 每次加密使用随机 nonce (12 字节), 输出格式: base64(payload), 其中
//!   payload = nonce(12) || ciphertext_and_tag
//!
//! 注意: AES-256-GCM 不提供 forward secrecy。若用户机器的 `secret.key` 被读取
//! 数据库密文同样会被解密, 因此请勿直接把本模块视为"绝对安全"的存储, 只保证
//! API Key 不会以明文形式直接出现在数据库 / 备份导出中

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
#[cfg(windows)]
use std::path::Path;
use tauri::{AppHandle, Manager};

/// 主密钥文件路径 (相对应用数据目录)
const KEY_FILE: &str = "secret.key";
/// AES-256 密钥字节数
const KEY_LEN: usize = 32;
/// GCM nonce 字节数
const NONCE_LEN: usize = 12;

/// 加载或首次生成主密钥
fn load_or_create_key(app: &AppHandle) -> Result<[u8; KEY_LEN], String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录: {e}"))?;
    let key_path = dir.join(KEY_FILE);

    // 已存在 → 读取
    if key_path.exists() {
        // 旧版本曾错误地授予 BUILTIN\Users 读取权限；每次读取前修复 ACL，
        // 以便已安装用户也能在升级后完成迁移。
        #[cfg(windows)]
        restrict_windows_permissions(&key_path)?;

        let raw = std::fs::read(&key_path).map_err(|e| format!("读取密钥文件失败: {e}"))?;
        let bytes: [u8; KEY_LEN] = raw
            .as_slice()
            .try_into()
            .map_err(|_| format!("密钥文件长度不正确 (应为 {KEY_LEN} 字节)"))?;
        return Ok(bytes);
    }

    // 不存在 → 生成新密钥
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    std::fs::write(&key_path, &key).map_err(|e| format!("写入密钥文件失败: {e}"))?;
    // Windows 下收紧文件 ACL 到当前用户
    #[cfg(windows)]
    restrict_windows_permissions(&key_path)?;
    Ok(key)
}

fn extract_windows_sid(output: &str) -> Option<&str> {
    let start = output.find("S-1-")?;
    let suffix_len = output[start + 4..]
        .bytes()
        .take_while(|byte| byte.is_ascii_digit() || *byte == b'-')
        .count();
    let sid = &output[start..start + 4 + suffix_len];
    sid.as_bytes()
        .last()
        .is_some_and(u8::is_ascii_digit)
        .then_some(sid)
}

/// Windows: 移除继承与宽泛的读取权限，仅允许当前 Windows 用户访问主密钥。
#[cfg(windows)]
fn restrict_windows_permissions(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let whoami = std::process::Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("无法查询当前 Windows 用户 SID: {e}"))?;
    if !whoami.status.success() {
        return Err(format!(
            "查询当前 Windows 用户 SID 失败: {}",
            String::from_utf8_lossy(&whoami.stderr).trim()
        ));
    }
    let whoami_stdout = String::from_utf8_lossy(&whoami.stdout);
    let sid = extract_windows_sid(&whoami_stdout)
        .ok_or_else(|| "无法从 whoami 输出中解析当前 Windows 用户 SID".to_string())?;
    let current_user = format!("*{sid}:(F)");

    let result = std::process::Command::new("icacls")
        .arg(path)
        .args([
            "/inheritance:r",
            "/grant:r",
            &current_user,
            "/remove:g",
            "*S-1-5-32-545",
            "*S-1-1-0",
            "*S-1-5-11",
            "/Q",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("无法收紧密钥文件权限: {e}"))?;
    if result.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&result.stderr);
    let stdout = String::from_utf8_lossy(&result.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    Err(format!("收紧密钥文件权限失败: {detail}"))
}

#[cfg(test)]
mod tests {
    use super::extract_windows_sid;

    #[test]
    fn extracts_sid_from_whoami_csv_output() {
        let output = "\"desktop\\user\",\"S-1-5-21-123-456-789-1001\"\r\n";
        assert_eq!(
            extract_windows_sid(output),
            Some("S-1-5-21-123-456-789-1001")
        );
    }

    #[test]
    fn rejects_output_without_sid() {
        assert_eq!(extract_windows_sid("unexpected output"), None);
    }
}

/// 加密: 明文 → base64(nonce || ciphertext)
/// 返回可直接入库的密文字符串.
pub fn encrypt_str(app: &AppHandle, plaintext: &str) -> Result<String, String> {
    let key = load_or_create_key(app)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化加密器失败: {e}"))?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("加密失败: {e}"))?;

    // payload = nonce || ciphertext
    let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(BASE64.encode(payload))
}

/// 解密: base64(nonce || ciphertext) → 明文
pub fn decrypt_str(app: &AppHandle, encoded: &str) -> Result<String, String> {
    let key = load_or_create_key(app)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("初始化解密器失败: {e}"))?;

    let payload = BASE64
        .decode(encoded)
        .map_err(|e| format!("密文不是合法 base64: {e}"))?;
    if payload.len() < NONCE_LEN {
        return Err("密文长度不合法".to_string());
    }
    let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("解密失败 (密钥不匹配或密文被篡改): {e}"))?;

    String::from_utf8(plaintext).map_err(|e| format!("解密结果不是合法 UTF-8: {e}"))
}

/// 前端加密明文 (用于存库). 空串直接返回空串 (不加密空值).
#[tauri::command]
pub fn secret_encrypt(app: tauri::AppHandle, plaintext: String) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    encrypt_str(&app, &plaintext)
}

/// 前端解密密文 (用于读取回显). 空串直接返回空串.
#[tauri::command]
pub fn secret_decrypt(app: tauri::AppHandle, encoded: String) -> Result<String, String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    decrypt_str(&app, &encoded)
}
