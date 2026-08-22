/**
 * 敏感配置加解密
 * AES-256-GCM
 */
import {invoke} from "@tauri-apps/api/core"
import {logger} from "./logger"

/**
 * 加密明文 → 密文字符串 (可直接入库).
 * 空串原样返回.
 */
export const encryptSecret = async (plaintext: string): Promise<string> => {
	if (!plaintext) return ""
	try {
		return await invoke<string>("secret_encrypt", {plaintext})
	} catch (error) {
		throw new Error(typeof error === "string" ? error : String(error))
	}
}

/**
 * 解密密文 → 明文.
 * 空串原样返回; 解密失败 (密钥缺失 / 密文被篡改 / 非本机加密) 时
 * 返回空字符串并记录日志, 不抛出 (调用方拿不到原文时按"未配置"处理).
 */
export const decryptSecret = async (encoded: string): Promise<string> => {
	if (!encoded) return ""
	try {
		return await invoke<string>("secret_decrypt", {encoded})
	} catch (error) {
		const REASON = typeof error === "string" && error.trim() ? error.trim() : "解密失败"
		await logger.error(`解密敏感配置失败: ${REASON}`, error)
		return ""
	}
}
