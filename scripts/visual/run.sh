#!/usr/bin/env bash
# 本地一键跑视觉回归：构建 → 装依赖 → 截图对比。
# 用法：scripts/visual/run.sh [--update]（--update 重建基线，见 tests/visual/README.md）
set -euo pipefail
cd "$(dirname "$0")/../.."

pnpm build
pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile
pnpm --dir tests/visual exec playwright install chromium

if [[ "${1:-}" == "--update" ]]; then
  pnpm --dir tests/visual run update-baselines
else
  pnpm --dir tests/visual test
fi
