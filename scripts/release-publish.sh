#!/usr/bin/env bash
# npm 发布与校验（与 release.sh 后半段一致，供本地与 CI 共用）
# Usage: ./scripts/release-publish.sh <version>
# Env:
#   NPM_DIST_TAG              dist-tag；未设置时预发布版本（含 '-'）自动用 beta，稳定版用 latest
#   SKIP_REGISTRY_VERIFY      设为 1 跳过发布后 registry 校验
#   NPM_PROPAGATION_ATTEMPTS  发布后 registry 校验的最大重试轮数，默认 25
#   NPM_PROPAGATION_DELAY_MS  发布后 registry 校验的重试间隔毫秒数，默认 60000
#   NODE_AUTH_TOKEN           CI 下发 npm token（本地可用 npm login）
#   SKIP_DOCKER_PUBLISH       默认 1，仅发 npm
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release-publish.sh <version>"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f "packages/opencode/package.json" ]; then
  echo "Error: packages/opencode/package.json not found"
  exit 1
fi

NPM_DIST_TAG="$("$ROOT/scripts/resolve-npm-dist-tag.sh" "$VERSION")"

echo "📦 Syncing package.json to version $VERSION..."
export VERSION
bun -e "
  const fs = require('fs');
  const path = 'packages/opencode/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = process.env.VERSION;
  if (pkg.optionalDependencies) {
    for (const key of Object.keys(pkg.optionalDependencies)) {
      if (key.startsWith('nuwaxcode-')) pkg.optionalDependencies[key] = process.env.VERSION;
    }
  }
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

cd packages/opencode

if [ -d "./dist/nuwaxcode" ]; then
  echo "🧹 Cleaning stale ./dist/nuwaxcode before publish..."
  rm -rf "./dist/nuwaxcode"
fi

echo "🧪 Pre-release version consistency checks..."
if [ "${SKIP_LOCAL_SMOKE:-}" = "1" ]; then
  # CI：不跑 bun 版 pre（runner 上 bun 解析 monorepo 可能触发 @babel/debug 异常）；仅校验 dist package.json 版本
  pre_ok=1
  shopt -s nullglob
  for pkg_json in dist/*/package.json; do
    name=$(node -p "require('./${pkg_json}').name")
    ver=$(node -p "require('./${pkg_json}').version")
    case "$name" in nuwaxcode-*)
      if [ "$ver" != "$VERSION" ]; then
        echo "dist 二进制包版本不一致：${name}=${ver}，期望 ${VERSION}"
        pre_ok=0
      fi
      ;;
    esac
  done
  shopt -u nullglob
  if [ "$pre_ok" != "1" ]; then exit 1; fi
  if [ ! -d dist ] || [ -z "$(ls -A dist 2>/dev/null)" ]; then
    echo "Error: dist 目录为空，请先下载 build artifact"
    exit 1
  fi
  echo "pre 校验通过（CI shell）：dist 平台包版本均为 ${VERSION}"
else
  bun run script/check-version-consistency.ts --phase pre --version "$VERSION"
fi

echo "🚀 Publishing to npm (dist-tag: ${NPM_DIST_TAG})..."
export SKIP_DOCKER_PUBLISH="${SKIP_DOCKER_PUBLISH:-1}"
export OPENCODE_VERSION="$VERSION"
export OPENCODE_RELEASE="1"

if [ "$NPM_DIST_TAG" = "latest" ]; then
  export OPENCODE_CHANNEL="latest"
else
  export OPENCODE_CHANNEL="$NPM_DIST_TAG"
fi

bun run script/publish.ts

if [ "${SKIP_REGISTRY_VERIFY:-}" = "1" ]; then
  echo "⏭️  SKIP_REGISTRY_VERIFY=1，跳过 npm optional 完整性校验"
else
  # npm 受理发布后，新版本可查询存在数秒到二十余分钟的传播延迟；
  # check-version-consistency 内部已带按轮次退避的重试（默认约 25 分钟预算），
  # 这里只保留短暂等待，避免首轮查询必然撞上 404。
  echo "🔍 Post-release version consistency checks (with propagation retries)..."
  sleep 5
  bun run script/check-version-consistency.ts --phase post --version "$VERSION"
fi

echo "✅ npm publish $VERSION completed"
