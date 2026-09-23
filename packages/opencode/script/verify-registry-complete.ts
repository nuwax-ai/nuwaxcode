#!/usr/bin/env bun
/**
 * 校验 npm 上已发布的 `nuwaxcode@<version>`：其 optionalDependencies 里的每个平台子包
 * 在 registry 上是否都能解析到同版本。
 *
 * 用于：
 * - 发版流程末尾确认本次发布完整（避免再次出现主包有、子包 404）；
 * - 排查用户 `npm i -g nuwaxcode` 报找不到 `nuwaxcode-linux-x64/package.json`。
 *
 * npm 受理发布后，子包可查询存在数秒到二十余分钟的传播延迟，因此这里按轮次
 * 重试（默认 25 轮、每轮间隔 60s，可用 NPM_PROPAGATION_ATTEMPTS /
 * NPM_PROPAGATION_DELAY_MS 覆盖），而不是单次查询即判定失败。
 *
 * 用法（在 packages/opencode 目录下，或通过 bun 指定路径）：
 *   bun run script/verify-registry-complete.ts
 *   bun run script/verify-registry-complete.ts 1.1.75
 */
import { $ } from "bun"
import pkg from "../package.json"
import {
  propagationAttempts,
  propagationDelayMs,
  registryVersion,
  sleep,
  waitFor,
} from "./lib/registry-propagation"

const version = process.argv[2] ?? pkg.version
const mainSpec = `nuwaxcode@${version}`

function parseOptionalDependencies(raw: string): Record<string, string> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const optional = parsed as Record<string, string>
  if (Object.keys(optional).length === 0) return undefined
  return optional
}

const optional = await waitFor(`主包元数据 ${mainSpec}`, async () => {
  const metaResult = await $`npm view ${mainSpec} optionalDependencies --json`.quiet().nothrow()
  if (metaResult.exitCode !== 0) return undefined
  return parseOptionalDependencies(metaResult.stdout.toString().trim())
})
if (optional === undefined) {
  console.error(
    `无法从 registry 读取 ${mainSpec} 的 optionalDependencies（已重试 ${propagationAttempts} 次）。` +
      `若尚未发布该版本的主包，请先发布或传入已存在的版本号。`,
  )
  process.exit(1)
}

// 按轮次整体复查缺失集合：每轮只查仍缺失的子包，总等待时间受轮数×间隔约束，
// 不会随子包数量线性放大。
const missing = new Set<string>()
for (const [name, ver] of Object.entries(optional)) {
  missing.add(`${name}@${String(ver)}`)
}
const total = missing.size

for (let round = 1; missing.size > 0 && round <= propagationAttempts; round++) {
  if (round > 1) await sleep(propagationDelayMs)
  for (const spec of missing) {
    if ((await registryVersion(spec)) !== undefined) missing.delete(spec)
  }
  if (missing.size > 0) {
    console.warn(
      `⏳ 第 ${round}/${propagationAttempts} 轮查询后仍有 ${missing.size}/${total} 个子包未生效，` +
        `继续等待 registry 传播...`,
    )
  }
}

if (missing.size > 0) {
  console.error(`nuwaxcode@${version} 以下 optional 子包在 registry 上缺失或不可安装（已重试 ${propagationAttempts} 轮）：`)
  for (const m of missing) {
    console.error(`  - ${m}`)
  }
  process.exit(1)
}

console.log(
  `校验通过：nuwaxcode@${version} 的 ${total} 个 optional 子包均在 registry 上存在。`,
)
