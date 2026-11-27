#!/usr/bin/env bash
# 生产反向断言（change add-harness-web-fetch-search-nov24 阶段5 / tasks 8.5）：
#
# 1) 源码层：验收注入面只在 feature 门控的 acceptance.rs；生产装配仍只走 official endpoint；
#    URL / DNS 拒绝规则（loopback / .local / 非全局单播 / 全地址校验）仍在生产代码里。
#    change web-evidence-provenance-nov26：五字段（content_scope / coverage / fetched_by /
#    binding / final_url）的赋值点只允许在 output.rs（字段声明 / FetchProvenance 构造 /
#    apply_provenance）与 provider.rs（收口）；白名单外出现即红——防「绕过漏斗手写取值」。
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
if ! rg -q 'eq_ignore_ascii_case\("localhost"\)' src-tauri/src/harness/web/url.rs \
  || ! rg -q 'ends_with\("\.local"\)' src-tauri/src/harness/web/url.rs; then
  echo "FAIL 生产 URL 规则不再拒绝 localhost / .local（src-tauri/src/harness/web/url.rs）" >&2
  exit 1
fi
if ! rg -q "fn globally_routable" src-tauri/src/harness/web/url.rs \
  || ! rg -qF "addresses.iter().any(|addr| !globally_routable(addr.ip()))" src-tauri/src/harness/web/preflight.rs; then
  echo "FAIL 生产全局单播校验消失或被放宽" >&2
  exit 1
fi
# 顺序不变式（876 的失败现场）：主机类拒绝必须同时存在于「provider 解析之前的基础参数层」与
# 「preflight 每跳复查」。少了前者的那次运行里，未配置 provider 把 localhost 报成了
# web_provider_unconfigured。真正的行为判据在 cargo test
# harness::web::tests::web_fetch_url_safety_rejection_precedes_provider_resolution，这里只做静态在位检查。
if ! rg -qF "url::blocked_host(&origin.host)" src-tauri/src/harness/web/mod.rs \
  || ! rg -qF "blocked_host(host)" src-tauri/src/harness/web/preflight.rs; then
  echo "FAIL 主机类 URL 拒绝不再是「解析前 + 每跳」双层" >&2
  exit 1
fi
# 抓取读写点的白名单（change web-evidence-provenance-nov26）：五字段只能由
# `output.rs` 的 FetchProvenance / apply_provenance 与 `provider.rs` 的收口写入。
# 文本级兜底，判的是「有人绕过漏斗在别处手写取值」；`*_tests.rs` 是测试代码，不在生产面。
stray=$(rg -n '\.(content_scope|coverage|fetched_by|binding|final_url)\s*=|^\s*(content_scope|coverage|fetched_by|binding|final_url):\s' \
  src-tauri/src --glob '*.rs' --glob '!**/*_tests.rs' \
  | grep -v '^src-tauri/src/harness/web/output.rs:' \
  | grep -v '^src-tauri/src/harness/web/provider.rs:' || true)
if [ -n "$stray" ]; then
  echo "FAIL 抓取五字段在漏斗之外被赋值：" >&2
  printf '%s\n' "$stray" >&2
  exit 1
fi
# 结构体字面量兜底：`FetchProvenance { ... }` 只允许出现在 output.rs（定义 / 构造器）。
stray_literal=$(rg -n 'FetchProvenance\s*\{' src-tauri/src --glob '*.rs' \
  | grep -v '^src-tauri/src/harness/web/output.rs:' || true)
if [ -n "$stray_literal" ]; then
  echo "FAIL FetchProvenance 构造被绕过单一漏斗：" >&2
  printf '%s\n' "$stray_literal" >&2
  exit 1
fi
echo "PASS 源码：注入面只在 acceptance.rs；official 装配与 URL / DNS 拒绝规则在位（解析前 + 每跳双层）；抓取五字段只经 output.rs / provider.rs 漏斗（含 FetchProvenance 字面量）"

echo "== 产物层（debug） =="
rlib=$(artifact_rlib "")
if grep -a -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" "$rlib"; then
  echo "FAIL 生产 debug rlib 含验收 Web 环境变量字符串：$rlib" >&2
  exit 1
fi
if grep -a -q "X-Lumir-Test-Fetch" "$rlib"; then
  echo "FAIL 生产 debug rlib 含验收测试专用请求头：$rlib" >&2
  exit 1
fi
echo "PASS 生产 debug rlib 不含验收注入面：$rlib"

echo "== 产物层（release） =="
release_rlib=$(artifact_rlib "--release")
if grep -a -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" "$release_rlib"; then
  echo "FAIL 生产 release rlib 含验收 Web 环境变量字符串：$release_rlib" >&2
  exit 1
fi
if grep -a -q "X-Lumir-Test-Fetch" "$release_rlib"; then
  echo "FAIL 生产 release rlib 含验收测试专用请求头：$release_rlib" >&2
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
