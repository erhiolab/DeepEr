/**
 * 资产协议
 */
export const ASSET_ORIGIN = /Windows|Win/i.test(navigator.userAgent) ? "http://nori-asset.localhost" : "nori-asset://localhost"

/**
 * 资产 URL
 * @param relativePath
 */
export const assetUrl = (relativePath: string): string => `${ASSET_ORIGIN}/${relativePath.replace(/^\/+/, "")}`