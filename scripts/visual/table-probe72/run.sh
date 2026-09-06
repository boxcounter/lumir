#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
pnpm exec vite build scripts/visual/table-probe72 --config scripts/visual/table-probe72/vite.config.ts
export CARGO_TARGET_DIR="$root/scripts/visual/table-probe72/target"
cargo build --manifest-path scripts/visual/table-probe72/Cargo.toml --features custom-protocol --locked --offline
mkdir -p scripts/visual/table-probe72/runtime
run="$(mktemp -d "$root/scripts/visual/table-probe72/runtime/run-XXXXXX")"
mkdir -p "$run/config"
export XDG_CONFIG_HOME="$run/config"
"$CARGO_TARGET_DIR/debug/table-probe72" > "$run/native.log" 2>&1
