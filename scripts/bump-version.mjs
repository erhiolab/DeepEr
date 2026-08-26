#!/usr/bin/env node
/**
 * DeepEr 版本号一键发布脚本
 *
 * 用法:
 *   node scripts/bump-version.mjs 0.2.0            # 仅同步 4 处版本号 (package.json / Cargo.toml / tauri.conf.json / Cargo.lock)
 *   node scripts/bump-version.mjs 0.2.0 --release  # 同步版本号 + 提交 + 打 tag + 推送 (触发 GitHub Actions 自动发版)
 *
 * 说明:
 *   - 版本号格式必须为 x.y.z (例如 0.2.0), 不要带 "v" 前缀
 *   - 不带 --release 时只改文件, 不碰 git, 方便先 review diff
 *   - --release 会 git add -A (包含所有未提交改动) → commit → tag → push
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

if (!version) {
    console.error("用法: node scripts/bump-version.mjs <版本号> [--release]")
    console.error("示例: node scripts/bump-version.mjs 0.2.0 --release")
    process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`版本号格式错误: "${version}" (需要 x.y.z, 例如 0.2.0, 不要带 v 前缀)`)
    process.exit(1)
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

// ---------- 发布流程: commit + tag + push ----------
console.log("\n开始发布流程 (--release)...")

// 1. 提交
const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim()
if (status) {
    console.log(`检测到 ${status.split("\n").length} 个未提交文件, 将全部纳入本次提交:`)
    console.log(status.split("\n").map((l) => `  ${l}`).join("\n"))
} else {
    console.log("工作区干净, 仅提交版本号变更。")
}

execSync("git add -A", { cwd: ROOT, stdio: "inherit" })
execSync(`git commit -m "Release v${version}"`, { cwd: ROOT, stdio: "inherit" })
console.log(`✓ 已提交: Release v${version}`)

// 2. 打 tag (若已存在同名 tag 则报错退出, 避免误覆盖)
try {
    execSync(`git tag v${version}`, { cwd: ROOT, stdio: "inherit" })
} catch {
    console.error(`✗ tag v${version} 已存在, 已中止 (如需覆盖请先手动删除旧 tag)`)
    process.exit(1)
}
console.log(`✓ 已打 tag: v${version}`)

// 3. 推送 (当前分支 + tag)
const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
try {
    execSync(`git push origin ${branch} --tags`, { cwd: ROOT, stdio: "inherit" })
} catch {
    console.error(`\n✗ git push 失败 (commit 与 tag 已创建, 可手动重试: git push origin ${branch} --tags)`)
    process.exit(1)
}
console.log(`✓ 已推送 ${branch} 与 tag v${version}, GitHub Actions 将自动构建并发布 Release。`)
console.log("  发布完成后, 应用内「检查更新」即可发现新版本。")
