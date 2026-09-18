#!/usr/bin/env bash
# 浏览器构建自证（M173）：把「这次跑用的是哪套 Playwright + 它要哪个 chromium 构建」打进日志。
# 本地（scripts/visual/run.sh）与 CI（.github/workflows/visual.yml）调同一份，两侧日志逐行可对照——
# M172 排查 visual 门禁红时，「本地与 CI 的浏览器构建是否同一个」是关键变量，当时只能靠
# 翻 pnpm-lock 与缓存目录名推断；这份日志把答案直接写进每次运行的输出。
#
# 只打印，不判定：本地与 CI 各跑一次，比对由人/agent 做（单侧无法自证相等）。
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "[visual] playwright 版本：$(pnpm --dir tests/visual exec playwright --version)"

# install --dry-run 只打印不下载，给出 Playwright 自己认的构建：版本号 + revision + 安装位置。
echo "[visual] playwright 期望的浏览器构建（install --dry-run chromium）："
pnpm --dir tests/visual exec playwright install --dry-run chromium 2>&1 |
  grep -E '^(Chrome|Chromium|  Install location)' | sed 's/^/    /' || true

# 本机缓存里**实际存在**的构建：多套 revision 并存时「跑的是哪一套」正是 M172 的首要嫌疑，
# 目录名 + 可执行文件的版本号把它摊开（目录名的 revision 与 --version 的 Chrome 版本一一对应）。
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  cache="$PLAYWRIGHT_BROWSERS_PATH"
elif [ "$(uname -s)" = "Darwin" ]; then
  cache="$HOME/Library/Caches/ms-playwright"
else
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/ms-playwright"
fi
echo "[visual] 本机 ms-playwright 缓存（${cache}）里的 chromium 构建："
for dir in "$cache"/chromium-[0-9]* "$cache"/chromium_headless_shell-[0-9]*; do
  [ -d "$dir" ] || continue
  bin=$(find "$dir" -maxdepth 5 -type f \
    \( -name chrome-headless-shell -o -name 'Google Chrome for Testing' -o -name chrome \) \
    2>/dev/null | head -n 1) || true
  if [ -n "${bin:-}" ] && [ -x "$bin" ]; then
    echo "    $(basename "$dir")：$("$bin" --version 2>&1 || echo '（--version 读取失败）')"
  else
    echo "    $(basename "$dir")：未找到可执行文件"
  fi
done
