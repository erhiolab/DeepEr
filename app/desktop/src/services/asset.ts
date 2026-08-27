/**
 * 资产协议
 */
export const ASSET_ORIGIN = /Windows|Win/i.test(navigator.userAgent) ? "http://deeper-asset.localhost" : "deeper-asset://localhost"

/**
 * 资产 URL
 * @param relativePath
 */
export const assetUrl = (relativePath: string): string => `${ASSET_ORIGIN}/${relativePath.replace(/^\/+/, "")}`

/**
 * 资产 URL 安全拼接: 仅接受安全的相对路径 (拒绝空段 / `.` / `..` / 绝对路径), 非法返回 null
 */
export const assetUrlSafe = (relative: string): string | null => {
	const CLEAN = relative.replace(/^\/+/, "").replace(/\\/g, "/")
	if (!CLEAN || CLEAN.startsWith("/")) return null
	if (CLEAN.split("/").some(seg => seg === ".." || seg === "." || !seg)) return null
	return assetUrl(CLEAN)
}
