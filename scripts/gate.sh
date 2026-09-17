#!/usr/bin/env bash
# scripts/gate.sh — 本地统一门禁入口：CI 四路门禁（rust/visual/perf/docs-check）的本地对应。
# agent 自验用：worker 完成前至少跑 quick；碰 src/** 跑 visual；reviewer 合并前跑 all。
#
# 用法：
#   scripts/gate.sh          # quick：fmt + clippy + cargo test + bindings 漂移 + tsc（根/视觉/单测）
#                            #        + 单测 + docs-check + openspec validate
#   scripts/gate.sh visual   # quick + 视觉套件隔离断言 + 视觉回归（默认 LUMIR_VISUAL_PORT=4273 隔离端口）
#   scripts/gate.sh all      # visual + 性能合同（release 构建，首次分钟级；本地无滚动基线时
#                            # 相对回归比较自动跳过，只 enforce 绝对阈值）
#
# 输出：每门禁一行 GATE PASS|FAIL|SKIP <名> <耗时>s；结尾 GATE RESULT: x/y PASS。
# 任一 FAIL 退出码 1；FAIL 的完整日志路径印在该行末尾。
set -uo pipefail
cd "$(dirname "$0")/.."

tier="${1:-quick}"
case "$tier" in quick | visual | all) ;; *)
  echo "用法：$0 [quick|visual|all]" >&2
  exit 2
  ;;
esac

for cmd in cargo pnpm node npx git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "错误：未找到 $cmd，门禁无法运行（环境要求见 README.md）。" >&2
    exit 2
  fi
done

pass=0
fail=0
skip=0

run_gate() {
  local name="$1"
  shift
  local start=$SECONDS
  local log
  log=$(mktemp -t "lumir-gate-${name}")
  if "$@" >"$log" 2>&1; then
    echo "GATE PASS ${name} $((SECONDS - start))s"
    rm -f "$log"
    pass=$((pass + 1))
  else
    echo "GATE FAIL ${name} $((SECONDS - start))s — 完整日志：$log"
    tail -n 30 "$log"
    fail=$((fail + 1))
  fi
}

skip_gate() {
  echo "GATE SKIP $1（$2）"
  skip=$((skip + 1))
}

# --- quick 层（对应 rust.yml + docs-check.yml + visual.yml 的 tsc 步） ---

run_gate cargo-fmt cargo fmt --check --manifest-path src-tauri/Cargo.toml
run_gate cargo-clippy cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
# cargo test 同时是 ADR 0003 §4 fixture 测试集与 ts-rs bindings 导出的载体
run_gate cargo-test cargo test --manifest-path src-tauri/Cargo.toml
# bindings 漂移检查须在 cargo test（重导出）之后。判据取「工作区相对索引的任何差异」而非
# `git diff`：后者只看已跟踪文件，新导出的 bindings 文件（untracked）不会让它报红，
# 而那正是这类漂移最常见的形态。两种差异（M 与 ??）现在都进 gate 日志并如实报红。
run_gate bindings-drift bash -c '
  dirty=$(git status --porcelain -- src/bindings/)
  if [ -n "$dirty" ]; then printf "%s\n" "$dirty"; exit 1; fi
'
run_gate tsc-root pnpm exec tsc --noEmit
if [ -d tests/visual/node_modules ]; then
  run_gate tsc-visual bash -c 'cd tests/visual && ../../node_modules/.bin/tsc --noEmit'
else
  skip_gate tsc-visual "tests/visual 依赖未装：pnpm --dir tests/visual install --ignore-workspace"
fi
# 前端最小单测层（src 的纯逻辑，零新增依赖；环境要求与取舍见 tests/unit/README.md）。
# tsc-unit 与 unit-tests 成对：前者守类型，后者守行为（tests/unit 不在根 tsconfig 的
# include 里，根 tsc 覆盖不到它）。
run_gate tsc-unit pnpm exec tsc -p tests/unit/tsconfig.json
run_gate unit-tests node tests/unit/run.mjs
# 制品门禁：与 CI 的 docs-check.yml 共用同一脚本（本地绿才等于 CI 绿）
run_gate docs-check bash scripts/docs-check.sh
run_gate openspec-validate npx --yes @fission-ai/openspec@1.12.0 validate --all --strict

# --- visual 层（对应 visual.yml） ---

if [ "$tier" = visual ] || [ "$tier" = all ]; then
  # 视觉套件自身的隔离设计断言（tests/visual/isolation.test.mjs）：纯 node:test，不碰浏览器，
  # 但它守的是视觉套件的运行期证据隔离，故归这一层（M153 之前它无人运行）。入口是
  # tests/visual/package.json 的脚本，CI 调同一入口。
  run_gate isolation-runs pnpm --dir tests/visual run test:isolation
  run_gate visual-regression env LUMIR_VISUAL_PORT="${LUMIR_VISUAL_PORT:-4273}" bash scripts/visual/run.sh
fi

# --- perf 层（对应 perf.yml） ---

if [ "$tier" = all ]; then
  run_gate vite-build pnpm build
  run_gate cargo-build-release cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml
  run_gate perf-cold-start node scripts/perf/cold-start.mjs
  run_gate perf-keypress-to-paint node scripts/perf/keypress-to-paint.mjs
  run_gate perf-open-file node scripts/perf/open-file.mjs
  run_gate perf-memory node scripts/perf/memory.mjs
  run_gate perf-thresholds node scripts/perf/check-thresholds.mjs
fi

echo "GATE RESULT: ${pass}/$((pass + fail)) PASS（SKIP ${skip}）"
[ "$fail" -eq 0 ]
