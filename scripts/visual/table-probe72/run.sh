#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
pnpm exec vite build scripts/visual/table-probe72 --config scripts/visual/table-probe72/vite.config.ts
export CARGO_TARGET_DIR="$root/scripts/visual/table-probe72/target"
cargo build --manifest-path scripts/visual/table-probe72/Cargo.toml --features custom-protocol --locked --offline
mkdir -p scripts/visual/table-probe72/runtime
node --experimental-strip-types --input-type=module -e 'import {small} from "./scripts/visual/table-probe72/fixture.ts"; import {writeFileSync} from "node:fs"; writeFileSync("scripts/visual/table-probe72/runtime/readonly-fixture.md", small, {flag:"wx"})' 2>/dev/null || test -f scripts/visual/table-probe72/runtime/readonly-fixture.md
run="$(mktemp -d "$root/scripts/visual/table-probe72/runtime/run-XXXXXX")"
mkdir -p "$run/config"
export XDG_CONFIG_HOME="$run/config"
"$CARGO_TARGET_DIR/debug/table-probe72" > "$run/native.log" 2>&1
