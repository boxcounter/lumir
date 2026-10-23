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
# 签名闸（M637，为什么）：0.9.2 的安装包只有 linker 塞进去的 ad-hoc 签名
# （Identifier=lumir-<hash>、Info.plist=not bound、无 _CodeSignature），macOS 通知守护进程按
# **代码签名身份**判定调用方资格，`requestAuthorization` 与 `addNotificationRequest` 全被拒
# （M636 定论）。修法是 `src-tauri/tauri.conf.json` 的 `bundle.macOS.signingIdentity: "-"`
# ——Tauri v2 官方的 ad-hoc 伪身份，签名发生在 app→dmg 之间。本闸在构建成功后断言那次签名
# 真的发生（构建退出 0 挡不住未签名产物）：`codesign --verify --deep --strict` 通过、
# `codesign -dv` 的 `Identifier` == 产物的 `CFBundleIdentifier`（且 == tauri.conf.json 的
# `identifier`，防止验错产物）、`Info.plist` 已绑定、`Sealed Resources` 在场。判据与
# docs/process/release.md「产物验证」同口径。`--bundles dmg` 重打后 tauri 会清理
# `bundle/macos/<Product>.app`，此时闸只读挂载 dmg、对 payload 里的同名 app 跑同一组判据。
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
# 免得因 worktree 缺 `.local` 假通过），并同时查当前 checkout 自己的 `.local`。打包位置见
# release.md「打包前置」的路径 A（主仓）/ 路径 B（mission worktree），两条都合法，闸语义一致。
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  sed -n '/^# 用法：/,/^# 输出：/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

check_only=0
no_bundle=0
extra_args=()
display_args=""
for arg in "$@"; do
  case "$arg" in
    --check-only) check_only=1 ;;
    --no-bundle)
      no_bundle=1
      extra_args+=("$arg")
      display_args="${display_args} ${arg}"
      ;;
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

if ! product_config=$(node -e '
  const conf = require("./src-tauri/tauri.conf.json");
  if (typeof conf.version !== "string" || conf.version === "") {
    console.error("tauri.conf.json 缺少顶层 version 字段");
    process.exit(1);
  }
  if (typeof conf.productName !== "string" || conf.productName === "") {
    console.error("tauri.conf.json 缺少 productName 字段");
    process.exit(1);
  }
  if (typeof conf.identifier !== "string" || conf.identifier === "") {
    console.error("tauri.conf.json 缺少 identifier 字段");
    process.exit(1);
  }
  process.stdout.write([conf.version, conf.productName, conf.identifier].join("\n"));
'); then
  echo "PACK FAIL version-gate 读不到 src-tauri/tauri.conf.json 的 version / productName / identifier" >&2
  echo "PACK RESULT: FAIL"
  exit 1
fi
version=$(printf '%s\n' "$product_config" | sed -n '1p')
product=$(printf '%s\n' "$product_config" | sed -n '2p')
bundle_identifier=$(printf '%s\n' "$product_config" | sed -n '3p')

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
  echo "PACK SKIP signature（--check-only）"
  echo "PACK RESULT: PASS"
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "PACK FAIL build 未找到 pnpm，无法执行 pnpm tauri build" >&2
  echo "PACK RESULT: FAIL"
  exit 2
fi

# release 产物根：CARGO_TARGET_DIR 可能是相对路径（相对 `src-tauri`，cargo 的 cwd），所以三种
# 形态都查：给定值原样、`src-tauri/` 下的给定值、默认 target。
release_dir() {
  local candidate
  for candidate in \
    "${CARGO_TARGET_DIR:+${CARGO_TARGET_DIR}/release}" \
    "${CARGO_TARGET_DIR:+src-tauri/${CARGO_TARGET_DIR}/release}" \
    "src-tauri/target/release"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

product_app_path() {
  local dir
  dir=$(release_dir) || return 1
  [ -d "${dir}/bundle/macos/${product}.app" ] || return 1
  printf '%s\n' "${dir}/bundle/macos/${product}.app"
}

# `--bundles dmg` 重打包后 tauri 会清理 bundle/macos/<Product>.app，产物只剩 dmg——这种形态下
# 签名判据落在 dmg 的 payload 上（挂载只读副本再判，判据完全相同）。同版本多份 dmg 取最新一份。
product_dmg_path() {
  local dir dmg
  dir=$(release_dir) || return 1
  dmg=$(ls -t "${dir}"/bundle/dmg/"${product}"_"${version}"_*.dmg 2>/dev/null | sed -n '1p')
  [ -n "$dmg" ] || return 1
  printf '%s\n' "$dmg"
}

# 对一份 app bundle 跑四条判据（与 docs/process/release.md「产物验证」同口径）：
# verify 通过 / 签名 Identifier == CFBundleIdentifier / Info.plist 绑定 / Sealed Resources 在场。
verify_app_signature() {
  local app="$1" details identifier info_line product_id verified
  if [ ! -f "$app/Contents/Info.plist" ]; then
    echo "PACK FAIL signature ${app} 缺少 Contents/Info.plist，不是完整的 app bundle"
    return 1
  fi
  if ! verified=$(codesign --verify --deep --strict --verbose=2 "$app" 2>&1); then
    echo "PACK FAIL signature codesign --verify --deep --strict 未通过（${app}）：${verified:-无输出}"
    return 1
  fi
  details=$(codesign -dv --verbose=4 "$app" 2>&1 || true)
  identifier=$(printf '%s\n' "$details" | sed -n 's/^Identifier=//p' | head -n 1)
  product_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2>/dev/null || true)
  if [ -z "$identifier" ]; then
    echo "PACK FAIL signature codesign -dv 读不到 Identifier（${app}）"
    return 1
  fi
  if [ -z "$product_id" ]; then
    echo "PACK FAIL signature 读不到产物 Info.plist 的 CFBundleIdentifier（${app}）"
    return 1
  fi
  if [ "$product_id" != "$bundle_identifier" ]; then
    echo "PACK FAIL signature 产物 CFBundleIdentifier=${product_id} 与 tauri.conf.json identifier=${bundle_identifier} 不一致——验的可能不是本批产物"
    return 1
  fi
  if [ "$identifier" != "$product_id" ]; then
    echo "PACK FAIL signature 签名 Identifier=${identifier} 与 CFBundleIdentifier=${product_id} 不一致（linker 签名？bundle 未被重新签名）"
    return 1
  fi
  # `Info.plist entries=N` 只出现在 bundle 级签名里；linker 签名打的是 `Info.plist=not bound`。
  # 不用 `grep -q`（`pipefail` 下早退的 grep 会让上游吃 SIGPIPE，把「命中」判成失败）。
  info_line=$(printf '%s\n' "$details" | grep '^Info.plist' || true)
  case "$info_line" in
    *"Info.plist entries="*) ;;
    *)
      echo "PACK FAIL signature Info.plist 未绑定到签名（linker 签名不绑 Info.plist，客户端身份因此对不上 bundle id）：${info_line:-无 Info.plist 行}"
      return 1
      ;;
  esac
  case "$details" in
    *"Sealed Resources version="*) ;;
    *)
      echo "PACK FAIL signature Sealed Resources 不在场（${app}）——不是 bundle 级签名"
      return 1
      ;;
  esac
  echo "PACK PASS signature ${app}（Identifier=${identifier}，Info.plist bound，Sealed Resources 在场）"
}

check_signature() {
  local app dmg mount status tmp_base
  if app=$(product_app_path); then
    verify_app_signature "$app"
    return $?
  fi
  if ! dmg=$(product_dmg_path); then
    echo "PACK FAIL signature 找不到 app 产物（期望 <target>/release/bundle/macos/${product}.app），也没有本版本的 dmg——无法断言签名"
    return 1
  fi
  tmp_base="${TMPDIR:-/tmp}"
  mount=$(mktemp -d "${tmp_base%/}/lumir-sign-gate.XXXXXX")
  echo "PACK INFO signature app bundle 不在场（dmg-only 打包），改验 dmg payload：${dmg}"
  if ! hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg" >/dev/null 2>&1; then
    echo "PACK FAIL signature 只读挂载 dmg 失败（${dmg}），无法断言 payload 签名"
    rmdir "$mount" 2>/dev/null || true
    return 1
  fi
  verify_app_signature "${mount}/${product}.app"
  status=$?
  hdiutil detach "$mount" >/dev/null 2>&1 || true
  rmdir "$mount" 2>/dev/null || true
  return "$status"
}

echo "PACK INFO build pnpm tauri build${display_args}"
start=$SECONDS
if pnpm tauri build ${extra_args[@]+"${extra_args[@]}"}; then
  echo "PACK PASS build $((SECONDS - start))s"
else
  status=$?
  echo "PACK FAIL build $((SECONDS - start))s"
  echo "PACK RESULT: FAIL"
  exit "$status"
fi

if [ "$no_bundle" = 1 ]; then
  echo "PACK SKIP signature（--no-bundle 不产出 app bundle）"
elif ! command -v codesign >/dev/null 2>&1; then
  echo "PACK SKIP signature（非 macOS：没有 codesign，签名不适用）"
elif ! check_signature; then
  echo "PACK RESULT: FAIL"
  exit 1
fi

echo "PACK RESULT: PASS"
