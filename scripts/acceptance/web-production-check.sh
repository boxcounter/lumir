#!/usr/bin/env bash
# 生产反向断言（change add-harness-web-fetch-search-nov24 阶段5 / tasks 8.5）：
#
# 1) 源码层：验收注入面只在 feature 门控的 acceptance.rs；生产装配仍只走 official endpoint；
#    URL / DNS 拒绝规则（loopback / .local / 非全局单播 / 全地址校验）仍在生产代码里。
# 2) 产物层：普通 lib（debug）与 release lib 的 rlib 都不含验收端点字符串。产物由
#    `cargo --message-format=json` 的 compiler-artifact 精确定位，不取「最新 rlib」——
#    最新产物可能是 `--features acceptance-web` 的构建（方向安全但不是生产产物选择器）。
# 3) 运行态（--runtime）：在隔离 XDG / 合成 vault 的真实 `pnpm tauri dev` 上设置
#    LUMIR_ACCEPTANCE_WEB_ENDPOINTS 指向哨兵端点，跑 876 场景；生产构建忽略该变量，
#    web_search 仍是 web_provider_unconfigured，web_fetch 的 localhost 仍被拒绝。
set -euo pipefail
cd "$(dirname "$0")/../.."

runtime=0
case "${1:-}" in
  --runtime) runtime=1 ;;
  "") ;;
  *) echo "用法：$0 [--runtime]" >&2; exit 2 ;;
esac

artifact_rlib() {
  # $1 = 额外 cargo 参数（如 --release）；从 JSON 事件里精确取 lumir_lib 的 rlib。
  local extra="$1"
  local events
  events=$(mktemp "${TMPDIR:-/tmp}/lumir-production-check.XXXXXX")
  # shellcheck disable=SC2086
  cargo build --lib --manifest-path src-tauri/Cargo.toml --no-default-features \
    --message-format=json $extra >"$events"
  python3 - "$events" <<'PY'
import json, sys
path = sys.argv[1]
found = []
with open(path, encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("reason") != "compiler-artifact":
            continue
        if event.get("target", {}).get("name") != "lumir_lib":
            continue
        found.extend(name for name in event.get("filenames", []) if name.endswith(".rlib"))
if len(found) != 1:
    raise SystemExit(f"FAIL 生产 lib 构建产物不是唯一 rlib：{found}")
print(found[0])
PY
  rm -f "$events"
}

echo "== 源码层 =="
if rg -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" src-tauri/src --glob '!**/acceptance.rs'; then
  echo "FAIL 生产源码读取了验收 Web 环境变量（acceptance.rs 之外）" >&2
  exit 1
fi
if ! rg -q "DeepSeekWebProvider::official" src-tauri/src/harness/web/mod.rs; then
  echo "FAIL 生产 Web 装配点没有 official constructor" >&2
  exit 1
fi
if ! rg -q 'special_host.eq_ignore_ascii_case\("localhost"\)' src-tauri/src/harness/web/preflight.rs \
  || ! rg -q 'ends_with\("\.local"\)' src-tauri/src/harness/web/preflight.rs; then
  echo "FAIL 生产 preflight 不再拒绝 localhost / .local" >&2
  exit 1
fi
if ! rg -q "fn globally_routable" src-tauri/src/harness/web/preflight.rs \
  || ! rg -qF "addresses.iter().any(|addr| !globally_routable(addr.ip()))" src-tauri/src/harness/web/preflight.rs; then
  echo "FAIL 生产 preflight 的全局单播校验消失或被放宽" >&2
  exit 1
fi
echo "PASS 源码：注入面只在 acceptance.rs；official 装配与 URL / DNS 拒绝规则在位"

echo "== 产物层（debug） =="
rlib=$(artifact_rlib "")
if grep -a -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" "$rlib"; then
  echo "FAIL 生产 debug rlib 含验收 Web 环境变量字符串：$rlib" >&2
  exit 1
fi
echo "PASS 生产 debug rlib 不含验收注入面：$rlib"

echo "== 产物层（release） =="
release_rlib=$(artifact_rlib "--release")
if grep -a -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" "$release_rlib"; then
  echo "FAIL 生产 release rlib 含验收 Web 环境变量字符串：$release_rlib" >&2
  exit 1
fi
echo "PASS 生产 release rlib 不含验收注入面：$release_rlib"

if [ "$runtime" = "1" ]; then
  echo "== 运行态（真实 pnpm tauri dev + 哨兵端点） =="
  log_dir=".local/acceptance/2026-11-25-stage5-web"
  mkdir -p "$log_dir"
  if ! LUMIR_ACCEPTANCE_WEB_ENDPOINTS='{"deepseek":"http://127.0.0.1:9","targets":{"prod-probe.test":9}}' \
    node scripts/acceptance/run.mjs 876 2>&1 | tee "$log_dir/stage5-production-runtime-876.log"; then
    echo "FAIL 生产 dev 运行态反向验收运行失败（见 $log_dir/stage5-production-runtime-876.log）" >&2
    exit 1
  fi
  grep -q "结论：1/1 PASS" "$log_dir/stage5-production-runtime-876.log" \
    || { echo "FAIL 生产 dev 运行态反向验收未 PASS（见 $log_dir/stage5-production-runtime-876.log）" >&2; exit 1; }
  echo "PASS 生产 dev 忽略验收注入；localhost 仍被拒绝"
fi
