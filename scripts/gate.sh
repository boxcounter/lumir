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
# 任一 FAIL 退出码 1；每一行（PASS 与 FAIL）都印出该门禁的完整日志路径。
# PASS 也留日志（backlog #34 的 2026-09-26 Alex 裁决）：只有一行 GATE PASS 时看不到用例数
# 与逐用例读数，复盘要用「34 张逐张比对通过」这类可 grep 的证据就得重跑一次。日志落在系统
# 临时目录（mktemp -t，`$TMPDIR` 下），按门禁名命名，不随本次运行删除；FAIL 额外回显末 30 行。
#
# bindings-drift 与「本地全绿才允许提交」的关系（M249）：改过 ts-rs 导出面的 change 会重导出
# src/bindings/**，重导出后先跑 quick 时那些改动还没进索引——未 staged 报红并提示先 `git add`；
# 已 `git add` 未 commit 只打 INFO、不判 FAIL。即「先 add/commit bindings，再跑 quick」是预期
# 行为，不再是一条假 FAIL。
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
    echo "GATE PASS ${name} $((SECONDS - start))s — 完整日志：$log"
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
# bindings 漂移检查须在 cargo test（重导出）之后。判据按 staged / unstaged 分流（M249，采纳
# finding 20260927-worker-line-wrap 的 3+1 组合）：
#   - **未 staged / 未跟踪**（工作区相对索引有差异）→ FAIL 并提示先 `git add`。这是真漂移：
#     重导出的结果没进索引，提交上去就是「bindings 没随代码走」。
#   - **已 staged、未 commit**（索引相对 HEAD 有差异）→ 只打 INFO，不判 FAIL。「本地全绿才允许
#     提交」的纪律下，改过 ts-rs 导出面的 change 必然先经历这一态；旧判据（`--porcelain` 非空即红）
#     把它与真漂移合成同一条红信号，于是每个这类 change 都要吃一次假 FAIL（M247 实证：` M
#     src/bindings/EditorConfig.ts` 在 `git add` 后仍红，只有 commit 才绿）。
#   CI 的新检出上不存在「已 staged 未 commit」态（工作区 = 索引 = HEAD），故本分流不影响 CI 侧
#   「bindings 没随代码提交」这条判据的效力。
run_gate bindings-drift bash -c '
  status=$(git status --porcelain -- src/bindings/)
  if [ -z "$status" ]; then exit 0; fi
  # porcelain v1 每行前两位是 XY（X = 索引态、Y = 工作区态）：Y 为空格即「已 staged」，
  # 其余（含未跟踪的 ??）都是「未 staged」；`MM`（staged 之后又改）同样归未 staged。
  staged=$(printf "%s\n" "$status" | grep -E "^[^ ?] " || true)
  unstaged=$(printf "%s\n" "$status" | grep -vE "^[^ ?] " || true)
  if [ -n "$staged" ]; then
    printf "INFO bindings 重导出已 git add、尚未 commit（本条门禁不判 FAIL；提交后本条即绿）：\n%s\n" "$staged"
  fi
  if [ -n "$unstaged" ]; then
    printf "FAIL 以下 bindings 漂移尚未进索引（重导出的结果没 git add），先 git add 再重跑：\n%s\n" "$unstaged"
    exit 1
  fi
  exit 0
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
