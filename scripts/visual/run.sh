#!/usr/bin/env bash
# 本地一键跑视觉回归：构建 → 装依赖 → 截图对比。
# 用法：scripts/visual/run.sh [--update] [Playwright 参数]（更新基线规则见 tests/visual/README.md）
set -euo pipefail
cd "$(dirname "$0")/../.."

# 端口归属检查：tests/visual/playwright.config.ts 本地开了 reuseExistingServer，
# 4173 被占时会静默复用来历不明的服务（旧构建 / 别的 worktree 的 vite preview），
# 截图对的是错误产物——静默假绿。占用即拒绝，必须先清场再跑。
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "错误：端口 4173 已被占用，占用进程如下：" >&2
  lsof -nP -iTCP:4173 -sTCP:LISTEN >&2
  echo "视觉回归必须跑在本脚本刚构建的产物上，拒绝复用未知来源的 4173 服务（防静默假绿）。" >&2
  echo "请先结束占用进程（kill <PID>）再重试。" >&2
  exit 1
fi

pnpm build
pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile
pnpm --dir tests/visual exec playwright install chromium

export LUMIR_VISUAL_FRESH_SERVER=1
if [[ "${1:-}" == "--update" ]]; then
  shift
  pnpm --dir tests/visual run update-baselines "$@"
else
  pnpm --dir tests/visual test "$@"
fi
