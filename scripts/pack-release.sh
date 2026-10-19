#!/usr/bin/env bash
# scripts/pack-release.sh — 打包唯一入口：先过版本闸，再 `pnpm tauri build`。
#
# 版本闸（为什么）：bump 原本只是打包前置的人工核对项，M596 打包时漏执行，0.8.0 的 dmg
# 装到的其实是含新能力的批次。闸的判据是「本机这个版本号已经交付过」：当前
# `src-tauri/tauri.conf.json` 的 `version`（唯一真源）已有同名证据目录
# `.local/releases/release-<version>/` 即拒绝打包，提示先按 semver 口径 bump。
# 证据目录由交付步骤（docs/process/release.md「交付惯例」）创建，本脚本不创建、不删除它。
# 「本批该 MINOR 还是 PATCH」仍需人裁决（tower 按 release.md 的批次性质口径判），闸只管
# 「同一个版本号不会被交付第二次」。
#
# 用法：
#   bash scripts/pack-release.sh                  # 闸 + 打包
#   bash scripts/pack-release.sh --check-only     # 只跑闸，不构建（门禁 / 本机快速自检）
#   bash scripts/pack-release.sh --bundles dmg    # 闸 + 只重打 dmg（dmg bundling 偶发失败的重试）
#                                                 # 其余参数原样传给 `pnpm tauri build`
#
# 输出：`PACK PASS|FAIL <检查项>`；跳过的步骤打 `PACK SKIP <检查项>`（不计入 PASS/FAIL 行）。
# 结尾 `PACK RESULT: PASS|FAIL`，与 scripts/gate.sh 的 `GATE RESULT` 同族。
# 退出码：0 = 闸通过（--check-only）/ 打包成功；1 = 闸拒绝或打包失败；2 = 环境缺命令。
#
# `.local/` 是 gitignore 的本地目录，闸语义是「本机这个版本已经交付过」，所以证据目录查的是
# 主仓 checkout 的 `.local`（worktree 里跑时经 `git rev-parse --git-common-dir` 指回主仓，
# 免得因 worktree 缺 `.local` 假通过），并同时查当前 checkout 自己的 `.local`。打包本身按
# release.md 要求在 master 的主仓 checkout 跑，不在 worktree。
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

check_only=0
extra_args=()
display_args=""
for arg in "$@"; do
  case "$arg" in
    --check-only) check_only=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      extra_args+=("$arg")
      display_args="${display_args} ${arg}"
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "PACK FAIL version-gate 未找到 node，读不到 src-tauri/tauri.conf.json 的 version" >&2
  echo "PACK RESULT: FAIL"
  exit 2
fi

if ! version=$(node -e '
  const conf = require("./src-tauri/tauri.conf.json");
  if (typeof conf.version !== "string" || conf.version === "") {
    console.error("tauri.conf.json 缺少顶层 version 字段");
    process.exit(1);
  }
  process.stdout.write(conf.version);
'); then
  echo "PACK FAIL version-gate 读不到 src-tauri/tauri.conf.json 的 version" >&2
  echo "PACK RESULT: FAIL"
  exit 1
fi

repo_root=$(pwd -P)
main_root="$repo_root"
if git_common=$(git rev-parse --git-common-dir 2>/dev/null); then
  case "$git_common" in
    /*) candidate=$(dirname "$git_common") ;;
    *) candidate=$(cd "$(dirname "$git_common")" 2>/dev/null && pwd -P) || candidate="" ;;
  esac
  if [ -n "$candidate" ]; then
    main_root="$candidate"
  fi
fi

found=""
for root in "$main_root" "$repo_root"; do
  evidence_dir="${root}/.local/releases/release-${version}"
  if [ -d "$evidence_dir" ]; then
    found="$evidence_dir"
    break
  fi
done
if [ -n "$found" ]; then
  echo "PACK FAIL version-gate 版本 ${version} 已有证据目录 ${found}——该版本号已交付过，先按 docs/process/release.md 的版本口径 bump（特性批 MINOR / 修复批 PATCH）再打包"
  echo "PACK RESULT: FAIL"
  exit 1
fi
echo "PACK PASS version-gate ${version}（${main_root}/.local/releases/release-${version} 不存在）"

if [ "$check_only" = 1 ]; then
  echo "PACK SKIP build（--check-only）"
  echo "PACK RESULT: PASS"
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "PACK FAIL build 未找到 pnpm，无法执行 pnpm tauri build" >&2
  echo "PACK RESULT: FAIL"
  exit 2
fi

echo "PACK INFO build pnpm tauri build${display_args}"
start=$SECONDS
if pnpm tauri build ${extra_args[@]+"${extra_args[@]}"}; then
  echo "PACK PASS build $((SECONDS - start))s"
  echo "PACK RESULT: PASS"
else
  status=$?
  echo "PACK FAIL build $((SECONDS - start))s"
  echo "PACK RESULT: FAIL"
  exit "$status"
fi
