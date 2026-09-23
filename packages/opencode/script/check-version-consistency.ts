#!/usr/bin/env bun
/**
 * 版本一致性校验脚本（发布前 + 发布后）。
 *
 * 设计目标：
 * 1) 统一“版本真相来源”为 packages/opencode/package.json 的 version；
 * 2) 发布前阻断所有“本地版本不一致”；
 * 3) 发布后阻断所有“registry/安装态版本不一致”。
 *
 * 用法：
 *   bun run script/check-version-consistency.ts --phase pre --version 1.1.93
 *   bun run script/check-version-consistency.ts --phase post --version 1.1.93
 */
import { $ } from "bun"
import pkg from "../package.json"
import { propagationAttempts, registryVersion, waitFor } from "./lib/registry-propagation"

type Phase = "pre" | "post"

function parseArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

const phase = (parseArg("--phase") ?? "pre") as Phase
const targetVersion = parseArg("--version") ?? pkg.version

if (!["pre", "post"].includes(phase)) {
  console.error(`不支持的 --phase: ${phase}，可选值仅为 pre | post`)
  process.exit(1)
}

async function ensureOptionalDependenciesConsistent(version: string) {
  // package.json schema 推断类型里未必包含 optionalDependencies；运行时在 release.sh 中会写入同步。
  const optional =
    (pkg as typeof pkg & { optionalDependencies?: Record<string, string> }).optionalDependencies ?? {}
  const entries = Object.entries(optional).filter(([name]) => name.startsWith("nuwaxcode-"))

  if (entries.length === 0) {
    // 当前仓库里 optionalDependencies 由 publish.ts 在 dist 聚合包里动态生成。
    // 因此源码 package.json 允许没有该字段，不应阻断发布。
    console.warn("package.json 未定义 nuwaxcode-* optionalDependencies，跳过源码 optional 一致性校验。")
    return
  }

  for (const [name, depVersion] of entries) {
    if (depVersion !== version) {
      console.error(
        `optionalDependencies 版本不一致：${name}=${depVersion}，期望 ${version}。` +
          "请先同步 package.json 后再发布。",
      )
      process.exit(1)
    }
  }
}

async function ensureDistBinariesConsistent(version: string) {
  const distPaths = [...new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })]
  if (distPaths.length === 0) {
    console.error("dist 目录中未找到任何二进制包 package.json。请先执行构建。")
    process.exit(1)
  }

  for (const rel of distPaths) {
    const file = `./dist/${rel}`
    const distPkg = (await Bun.file(file).json()) as { name: string; version: string }
    if (!distPkg.name.startsWith("nuwaxcode-")) continue
    if (distPkg.version !== version) {
      console.error(
        `dist 二进制包版本不一致：${distPkg.name}=${distPkg.version}，期望 ${version}。` +
          "请重建二进制后再发布。",
      )
      process.exit(1)
    }
  }
}

function smokeBinaryCandidates(): string[] {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
  const core = `nuwaxcode-${os}-${arch}`
  const names = [core]
  if (os === "linux" && arch === "x64") {
    names.push(`${core}-baseline`)
  }
  if (os === "darwin" && arch === "x64") {
    names.push(`${core}-baseline`)
  }
  return names.map((name) => `./dist/${name}/bin/opencode`)
}

async function ensureLocalSmokeVersion(version: string) {
  if (process.env.SKIP_LOCAL_SMOKE === "1") {
    console.warn("SKIP_LOCAL_SMOKE=1，跳过本地 smoke（CI 仅依赖 dist package.json 版本校验）。")
    return
  }
  // 烟测使用与当前 runner 平台匹配的 dist 产物；CI（linux x64）不再误跑 darwin 二进制。
  let smokeBin: string | undefined
  for (const candidate of smokeBinaryCandidates()) {
    if (await Bun.file(candidate).exists()) {
      smokeBin = candidate
      break
    }
  }
  if (!smokeBin) {
    console.warn(`未找到当前平台可执行的 smoke 二进制，跳过本地版本烟测。`)
    return
  }

  await $`chmod +x ${smokeBin}`.quiet().nothrow()

  const out = await $`${smokeBin} --version`.quiet().nothrow()
  if (out.exitCode !== 0) {
    console.error(`本地 smoke 二进制执行失败（${smokeBin}，exit=${out.exitCode}）。`)
    process.exit(1)
  }
  const actual = out.stdout.toString().trim()
  if (actual !== version) {
    console.error(`本地二进制版本不一致：smoke=${actual}，期望 ${version}。`)
    process.exit(1)
  }
  console.log(`smoke 版本校验通过：${smokeBin} => ${actual}`)
}

async function ensureRegistryMainVersion(version: string) {
  const spec = `nuwaxcode@${version}`
  // npm 受理发布后新版本需要传播时间，单次查询会把传播延迟误判为发布失败。
  const actual = await waitFor(`registry 主包 ${spec}`, () => registryVersion(spec))
  if (actual === undefined) {
    console.error(`registry 中未查到 ${spec}（已重试 ${propagationAttempts} 次，超出 npm 传播预算）。`)
    process.exit(1)
  }
  if (actual !== version) {
    console.error(`registry 主包版本不一致：${actual}，期望 ${version}。`)
    process.exit(1)
  }
}

async function ensureRegistryOptionalsComplete(version: string) {
  const result =
    await $`bun run script/verify-registry-complete.ts ${version}`.cwd(process.cwd()).quiet().nothrow()
  if (result.exitCode !== 0) {
    console.error("registry optionalDependencies 完整性校验失败。")
    if (result.stderr.toString().trim()) console.error(result.stderr.toString())
    process.exit(1)
  }
}

async function ensureInstalledCliVersion(version: string) {
  const cmd = [
    "tmpdir=$(mktemp -d)",
    "cd \"$tmpdir\"",
    "npm init -y >/dev/null",
    "npm i \"nuwaxcode@" + version + "\" --registry=https://registry.npmjs.org/ >/dev/null 2>&1",
    "./node_modules/.bin/nuwaxcode -v",
  ].join(" && ")
  // 安装失败多为 optional 子包传播滞后；完整安装较重，只做少量重试。
  const actual = await waitFor(
    `安装态 CLI nuwaxcode@${version}`,
    async () => {
      const run = await $`bash -lc ${cmd}`.quiet().nothrow()
      if (run.exitCode !== 0) return undefined
      const out = run.stdout.toString().trim()
      return out || undefined
    },
    3,
  )
  if (actual === undefined) {
    console.error("安装态 CLI 版本校验执行失败。")
    process.exit(1)
  }
  if (actual !== version) {
    console.error(`安装态 CLI 版本不一致：${actual}，期望 ${version}。`)
    process.exit(1)
  }
}

async function runPre(version: string) {
  if (pkg.version !== version) {
    console.error(`package.json 版本不一致：${pkg.version}，期望 ${version}。`)
    process.exit(1)
  }
  await ensureOptionalDependenciesConsistent(version)
  await ensureDistBinariesConsistent(version)
  await ensureLocalSmokeVersion(version)
  console.log(`pre 校验通过：本地主包/optional/dist/烟测版本均为 ${version}`)
}

async function runPost(version: string) {
  await ensureRegistryMainVersion(version)
  await ensureRegistryOptionalsComplete(version)
  await ensureInstalledCliVersion(version)
  console.log(`post 校验通过：registry 与安装态 CLI 版本均为 ${version}`)
}

if (phase === "pre") {
  await runPre(targetVersion)
} else {
  await runPost(targetVersion)
}
