#!/usr/bin/env bun
/**
 * npm registry 传播等待工具（发布后校验专用）。
 *
 * npm publish 返回成功只代表 registry 受理了发布，新版本变得可查询存在数十秒到
 * 二十余分钟不等的传播延迟（v1.17.10 的 nuwaxcode-darwin-arm64 实测约 20 分钟）。
 * 发布后校验若单次查询即判定失败，会把传播延迟误报成发布失败，也会掩盖真正的包丢失。
 *
 * 环境变量：
 *   NPM_PROPAGATION_ATTEMPTS  最大尝试次数，默认 25
 *   NPM_PROPAGATION_DELAY_MS  两次尝试的间隔毫秒数，默认 60000
 */
import { $ } from "bun"

export const propagationAttempts = Number(process.env.NPM_PROPAGATION_ATTEMPTS ?? 25)
export const propagationDelayMs = Number(process.env.NPM_PROPAGATION_DELAY_MS ?? 60_000)

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 反复执行 check 直到返回非 undefined 或重试预算耗尽，返回 check 的最后一次结果。
 * check 需自行把传播期的 404 等情况归一为 undefined。
 */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  attempts: number = propagationAttempts,
): Promise<T | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await check()
    if (result !== undefined) return result
    if (attempt === attempts) break
    console.warn(
      `⏳ ${what} 尚未生效（第 ${attempt}/${attempts} 次查询），${propagationDelayMs / 1000}s 后重试...`,
    )
    await sleep(propagationDelayMs)
  }
  return undefined
}

/** 查询 spec（如 nuwaxcode@1.2.3）解析到的版本；传播期或不存在时返回 undefined。 */
export async function registryVersion(spec: string): Promise<string | undefined> {
  const check = await $`npm view ${spec} version --registry=https://registry.npmjs.org/`.quiet().nothrow()
  if (check.exitCode !== 0) return undefined
  const version = check.stdout.toString().trim()
  return version || undefined
}
