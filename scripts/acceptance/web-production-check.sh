#!/usr/bin/env bash
# 生产反向断言（change add-harness-web-fetch-search-nov24 阶段5）：
# 普通 lib（不带 acceptance-web feature）不得编译验收注入面，也不得读取
# LUMIR_ACCEPTANCE_WEB_ENDPOINTS；生产 Web 装配仍只走 official endpoint。
set -euo pipefail
cd "$(dirname "$0")/../.."

cargo build --lib --manifest-path src-tauri/Cargo.toml --no-default-features >/dev/null

# 1) 源码层：环境变量只在 feature 门控的 acceptance.rs 里出现。
if rg -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS" src-tauri/src --glob '!**/acceptance.rs'; then
  echo "FAIL 生产源码读取了验收 Web 环境变量（acceptance.rs 之外）" >&2
  exit 1
fi

# 2) 产物层：普通 lib 的 rlib 不含验收端点字符串。
rlib=$(find src-tauri/target/debug/deps -maxdepth 1 -name 'liblumir_lib-*.rlib' -print0 \
  | xargs -0 ls -t | head -n 1)
if [ -z "$rlib" ]; then
  echo "FAIL 找不到 liblumir_lib rlib" >&2
  exit 1
fi
if strings "$rlib" | grep -q "LUMIR_ACCEPTANCE_WEB_ENDPOINTS"; then
  echo "FAIL 生产 rlib 含验收 Web 环境变量字符串：$rlib" >&2
  exit 1
fi

# 3) 生产装配点仍只用 official constructor。
if ! rg -q "DeepSeekWebProvider::official" src-tauri/src/harness/web/mod.rs; then
  echo "FAIL 生产 Web 装配点没有 official constructor" >&2
  exit 1
fi

echo "PASS 生产 lib 不含验收注入面；Web 装配仍为 official endpoint"
