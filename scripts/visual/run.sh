#!/usr/bin/env bash
# 本地一键跑视觉回归：构建 → 装依赖 → 截图对比。
# 用法：scripts/visual/run.sh [--update] [Playwright 参数]（更新基线规则见 tests/visual/README.md）
#
# 整页像素对比归**本地**：CI（visual.yml）置 LUMIR_VISUAL_STRUCTURAL=1，只跑结构 / 计算属性断言。
# 所以动了视觉相关代码后必须跑一次本脚本，「CI 绿」不再代表像素层没回归（依据见 tests/visual/README.md）。
set -euo pipefail
cd "$(dirname "$0")/../.."

# 端口归属检查：tests/visual/playwright.config.ts 本地开了 reuseExistingServer，
# $port 被占时会静默复用来历不明的服务（旧构建 / 别的 worktree 的 vite preview），
# 截图对的是错误产物——静默假绿。占用即拒绝，必须先清场再跑。
port="${LUMIR_VISUAL_PORT:-4173}"
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "错误：端口 $port 已被占用，占用进程如下：" >&2
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
  echo "视觉回归必须跑在本脚本刚构建的产物上，拒绝复用未知来源的 $port 服务（防静默假绿）。" >&2
  echo "请先结束占用进程（kill <PID>）再重试。" >&2
  exit 1
fi

pnpm build
pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile
pnpm --dir tests/visual exec playwright install chromium
# 浏览器构建自证（M173）：与 CI 同一份脚本，两侧日志可逐行对照
bash scripts/visual/browser-build.sh

structural="${LUMIR_VISUAL_STRUCTURAL:-0}"
if [[ "$structural" == "1" ]]; then
  echo "[visual] 模式：仅结构 / 计算属性断言（LUMIR_VISUAL_STRUCTURAL=1，像素断言只记日志不对比）"
else
  echo "[visual] 模式：全量（含整页 / 元素像素对比）"
fi

export LUMIR_VISUAL_FRESH_SERVER=1
if [[ "${1:-}" == "--update" ]]; then
  # 结构模式下像素断言整个不执行，--update 会「成功」却什么都不刷新——静默空跑，
  # 与「基线已更新」的误判只差一步。拒绝，并要求先清掉开关。
  if [[ "$structural" == "1" ]]; then
    echo "错误：LUMIR_VISUAL_STRUCTURAL=1 时像素断言不执行，--update 不会刷新任何基线。" >&2
    echo "请先 unset LUMIR_VISUAL_STRUCTURAL 再更新基线。" >&2
    exit 1
  fi
  shift
  pnpm --dir tests/visual run update-baselines "$@"
else
  pnpm --dir tests/visual test "$@"
fi
