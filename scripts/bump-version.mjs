#!/usr/bin/env node
/**
 * DeepEr 版本号一键发布脚本
 *
 * 用法:
 *   node scripts/bump-version.mjs 0.1.0                       # 仅同步 4 处版本号, 不碰 git
 *   node scripts/bump-version.mjs 0.1.0 --release             # 同步版本号 + 提交 + 打 tag + 推送
 *   node scripts/bump-version.mjs 0.1.0 --release --force     # 同上, 但允许覆盖已存在的同名 tag (本地 + 远程)
 *
 * 说明:
 *   - 版本号格式必须为 x.y.z (例如 0.2.0), 不要带 "v" 前缀
 *   - --release 流程: 只提交 4 个版本号文件 (不会卷入其他未提交改动)
 *     → 提交 "Release vX.Y.Z" → 打 tag vX.Y.Z (打在刚提交的 commit 上, 即当前最新提交)
 *     → git push origin <当前分支> 与 vX.Y.Z
 *   - --force: 本地/远程已存在同名 tag 时, 先删除旧 tag 再重新打/推 (用于修正打错位置的 tag)
 */

import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FILES = {
	packageJson: path.join(ROOT, "app", "desktop", "package.json"),
	cargoToml: path.join(ROOT, "app", "desktop", "src-tauri", "Cargo.toml"),
	tauriConf: path.join(ROOT, "app", "desktop", "src-tauri", "tauri.conf.json"),
	cargoLock: path.join(ROOT, "app", "desktop", "src-tauri", "Cargo.lock"),
}

const args = process.argv.slice(2)
const version = args.find((a) => !a.startsWith("--"))
const isRelease = args.includes("--release")
const isForce = args.includes("--force")

if (!version) {
	console.error("用法: node scripts/bump-version.mjs <版本号> [--release] [--force]")
	console.error("示例: node scripts/bump-version.mjs 0.2.0 --release")
	process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
	console.error(`版本号格式错误: "${version}" (需要 x.y.z, 例如 0.2.0, 不要带 v 前缀)`)
	process.exit(1)
}
if (isForce && !isRelease) {
	console.error("--force 仅在 --release 模式下有意义 (用于覆盖已存在的 tag), 已忽略")
}

const versionFiles = Object.values(FILES).map((p) => path.relative(ROOT, p).replace(/\\/g, "/"))
const tagName = `v${version}`

// 在改动任何文件之前, 检查同名 tag 是否已存在 (本地 / 远程)
// 避免"先提交了版本文件但 tag 未打"导致的状态不一致.
if (isRelease) {
	const tagExistsLocal = execSync(`git tag -l "${tagName}"`, { cwd: ROOT, encoding: "utf8" }).trim() === tagName
	let tagExistsRemote = false
	try {
		execSync(`git ls-remote --exit-code origin "refs/tags/${tagName}"`, { cwd: ROOT, stdio: "pipe" })
		tagExistsRemote = true
	} catch {
		tagExistsRemote = false
	}
	if (tagExistsLocal || tagExistsRemote) {
		if (!isForce) {
			console.error(`✗ tag ${tagName} 已存在 (本地: ${tagExistsLocal}, 远程: ${tagExistsRemote}).`)
			console.error(`  当前 tag 可能指向旧提交; 若确认要覆盖, 请加 --force 重新运行:`)
			console.error(`  node scripts/bump-version.mjs ${version} --release --force`)
			process.exit(1)
		}
		console.log(`--force: 删除已存在的 tag ${tagName} (本地 + 远程) 后重新打...`)
		if (tagExistsLocal) execSync(`git tag -d "${tagName}"`, { cwd: ROOT, stdio: "inherit" })
		if (tagExistsRemote) execSync(`git push origin ":refs/tags/${tagName}"`, { cwd: ROOT, stdio: "inherit" })
		console.log(`✓ 已删除旧 tag ${tagName}`)
	}
}

const rel = (p) => path.relative(ROOT, p)

/** 更新 JSON 文件顶层 "version" 字段, 只替换该行, 其余内容与格式完全不动 */
function bumpJson(file) {
	const raw = readFileSync(file, "utf8")
	const m = raw.match(/^\s*"version":\s*"([^"]+)"/m)
	if (!m) {
		console.error(`✗ ${rel(file)} 中未找到顶层 "version" 字段`)
		process.exit(1)
	}
	const out = raw.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`)
	writeFileSync(file, out)
	return m[1]
}

/** 更新 Cargo.toml [package] 段的 version */
function bumpCargoToml(file) {
	const raw = readFileSync(file, "utf8")
	const m = raw.match(/^version = "([^"]+)"/m)
	const out = raw.replace(/^version = "([^"]+)"/m, `version = "${version}"`)
	writeFileSync(file, out)
	return m ? m[1] : "?"
}

/** 更新 Cargo.lock 里 name = "deeper" 的包版本 (漏改会导致 cargo 编译失败, 兼容 CRLF/LF) */
function bumpCargoLock(file) {
	const raw = readFileSync(file, "utf8")
	const out = raw.replace(/^(name = "deeper"\r?\nversion = ")[^"]+(")/m, `$1${version}$2`)
	writeFileSync(file, out)
}

// 在改动版本号之前, 记录当前"非版本文件"的未提交改动 (本次发布不会提交它们)
const otherChanges = []
if (isRelease) {
	const status0 = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim()
	for (const line of status0.split("\n")) {
		if (!line.trim()) continue
		const f = line.slice(3).trim().replace(/\\/g, "/")
		if (!versionFiles.includes(f)) otherChanges.push(f)
	}
}

console.log("正在同步版本号...")
const oldPkg = bumpJson(FILES.packageJson)
const oldTauri = bumpJson(FILES.tauriConf)
const oldCargo = bumpCargoToml(FILES.cargoToml)
bumpCargoLock(FILES.cargoLock)

console.log(`✓ 版本号 ${oldPkg} → ${version}`)
console.log(`  - ${rel(FILES.packageJson)}  ${oldPkg} → ${version}`)
console.log(`  - ${rel(FILES.tauriConf)}  ${oldTauri} → ${version}`)
console.log(`  - ${rel(FILES.cargoToml)}    ${oldCargo} → ${version}`)
console.log(`  - ${rel(FILES.cargoLock)}  (deeper 包) 已同步`)

// 校验一致性
const checkJson = (file) => JSON.parse(readFileSync(file, "utf8")).version === version
const checkToml = (file) => new RegExp(`^version = "${version}"`, "m").test(readFileSync(file, "utf8"))
const checkLock = (file) => new RegExp(`^name = "deeper"\\r?\\nversion = "${version}"`, "m").test(readFileSync(file, "utf8"))
const ok = checkJson(FILES.packageJson) && checkJson(FILES.tauriConf) && checkToml(FILES.cargoToml) && checkLock(FILES.cargoLock)
if (!ok) {
	console.error("✗ 校验失败: 版本号未同步一致, 请检查后重试")
	process.exit(1)
}
console.log("✓ 校验通过: 4 处版本号一致")

if (!isRelease) {
	console.log("\n(未指定 --release, 只更新了版本号。review diff 确认无误后可运行:)")
	console.log(`  node scripts/bump-version.mjs ${version} --release`)
	console.log(" 以完成 提交 + 打 tag + 推送, 触发 GitHub Actions 自动构建发布。")
	process.exit(0)
}

// ---------- 发布流程: 提交(仅版本文件) + 打 tag + 推送 ----------
console.log("\n开始发布流程 (--release)...")

// 1. 提示其他未提交改动 (不纳入本次提交)
if (otherChanges.length > 0) {
	console.log(`⚠ 检测到 ${otherChanges.length} 个其他未提交改动, 本次不会提交它们 (如需一起发布请先手动提交):`)
	console.log(otherChanges.map((f) => `  ${f}`).join("\n"))
}

// 2. 仅暂存版本号文件并提交
execSync(`git add ${versionFiles.map((f) => `"${f}"`).join(" ")}`, { cwd: ROOT, stdio: "inherit" })
try {
	execSync(`git commit -m "Release v${version}"`, { cwd: ROOT, stdio: "inherit" })
} catch {
	console.error(`✗ 提交失败: 版本文件没有实际变化 (可能已经是 v${version}) 或提交被拒绝.`)
	process.exit(1)
}
console.log(`✓ 已提交 (仅版本号文件): Release v${version}`)

// 3. 打 tag: 打到刚提交的 commit (当前 HEAD / 最新提交)
//    (同名 tag 是否存在的检查与 --force 删除已在脚本开头完成)
execSync(`git tag "${tagName}"`, { cwd: ROOT, stdio: "inherit" })
console.log(`✓ 已打 tag: ${tagName} → 指向最新提交 (Release v${version})`)

// 4. 推送: 当前分支 + tag
const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
try {
	execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: "inherit" })
	console.log(`✓ 已推送分支 ${branch}`)
	execSync(isForce ? `git push origin --force "${tagName}"` : `git push origin "${tagName}"`, { cwd: ROOT, stdio: "inherit" })
	console.log(`✓ 已推送 tag ${tagName}, GitHub Actions 将自动构建并发布 Release。`)
} catch {
	console.error(`\n✗ git push 失败 (commit 与 tag 已创建, 可手动重试:)`)
	console.error(`  git push origin ${branch}`)
	console.error(`  git push origin "${tagName}"`)
	process.exit(1)
}
console.log("  发布完成后, 应用内「检查更新」即可发现新版本。")
