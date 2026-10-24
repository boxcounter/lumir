#!/usr/bin/env bash
# scripts/docs-check.sh — 制品门禁的唯一实现（docs/adr/ 的结构与索引 + openspec 相对链接可达性
# + 验收场景覆盖表生成一致性）。
# 本地 `scripts/gate.sh quick` 与 CI 的 .github/workflows/docs-check.yml 调的是同一份脚本：
# 「本地全绿才允许提交」要求本地跑的就是 CI 跑的那条命令，两处各写一遍必然漂移
#（M153；REVIEW.md 「同一语义两处真源」条：同一语义不要两处真源）。
#
# 校验内容（口径本体见 docs/process/adr-lifecycle.md）：
#   1. docs/adr/ 下每份 ADR 的文件结构、状态字段、日期与角色字段、必备章节
#      - 状态值合法（合法集合见下），与「deferred 必带全角括号注解」**两条分别校验**
#        （adr-lifecycle.md 的 `deferred` 一节定稿口径：裸 deferred 非法）
#   2. docs/adr/README.md 索引与 ADR 文件双向一致
#   3. openspec/**/*.md 内相对链接的可达性（实现在 scripts/openspec-links.sh，本脚本调它）
#   4. OpenSpec 归档对账：活跃 change 的 MODIFIED delta 是否静默删掉了 living spec 的段落
#      （实现在 scripts/openspec-archive-check.mjs，本脚本调它——`openspec archive` 对 MODIFIED 是
#      整块替换，delta 少抄的段落在归档时静默消失，validate 与链接检查都看不见）
#   5. 归档队列：tasks 全勾的活跃 change 是否在 docs/backlog.md 有且仅有一条归档跟踪条目
#      （同一脚本的门禁模式顺带判；口径见 docs/process/openspec-workflow.md「批次收尾 checklist」）
#   6. 验收场景覆盖表：scripts/acceptance/COVERAGE.md 与 scenarios/*.md 的 front-matter 是否一致，
#      以及 id / item / title 必填、id 唯一、item 在覆盖表内一项一行（场景间共用 item 合法）
#      （实现在 scripts/acceptance/coverage.mjs，本脚本调它——覆盖表是生成物，手维护或忘了重新
#      生成都会静默失真；`node scripts/acceptance/run.mjs --check` 调的是同一份实现）
# 输出：失败时逐条打印问题（CI 上同时是 ::error:: 注解）并以 1 退出。
#
# 注意：OpenSpec 的 **结构 / 制品完整性** 校验不在这里——权威实现是 `openspec validate --all
# --strict`（CI 的 docs-check.yml 与本地 gate.sh 都调它，两者同一命令），故无需在此复制一遍。
# 第 3 条（相对链接可达性）不同：`validate` 不查链接、归档又会把目录移深一层，是另一条判据，
# 故落在这里——挂本脚本而非 gate.sh，是为了让本地 `gate.sh quick` 与 CI 的 docs-check.yml
# 同时继承同一条命令（REVIEW.md 「同一语义两处真源」条：同一语义不要两处真源）。
# 第 4 条（归档对账）同理：`validate` 只看结构与 SHALL/场景在场，不比对 delta 与 living spec
# 的段落，MODIFIED 整块替换时少抄的段落它一律放行。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
shopt -s nullglob

# --- ADR 文件结构 ---

files=(docs/adr/[0-9][0-9][0-9][0-9]-*.md)
if [ ${#files[@]} -eq 0 ]; then
  echo "::error::docs/adr/ 下没有任何 ADR 文件"
  exit 1
fi

for f in "${files[@]}"; do
  base=$(basename "$f")
  num=${base:0:4}

  # 标题格式，且编号与文件名一致
  if ! head -1 "$f" | grep -qE "^# ADR ${num}: .+"; then
    echo "::error file=${f}::首行须为 '# ADR ${num}: <标题>'"
    fail=1
  fi

  # 状态字段合法：token 之后允许一段全角括号注解（0005 是 `deferred（2026-09-12 起…）`）。
  # `deferred` 是 ADR 0006 定下的真实生命周期状态（搁置非放弃），与 deprecated 语义不同，
  # 故合法值集合含它（tower 2026-09-17 裁决；语义定义在 docs/process/adr-lifecycle.md）。
  status=$(grep -m1 -E '^- 状态: ' "$f" | sed 's/^- 状态: //' || true)
  if ! echo "$status" | grep -qE '^(proposed|accepted|deprecated|deferred|superseded by ADR-[0-9]{4})(（[^）]*）)?$'; then
    echo "::error file=${f}::状态字段非法：'${status}'（合法值：proposed / accepted / deprecated / deferred / superseded by ADR-NNNN，可附 （…） 注解）"
    fail=1
  fi

  # 第二条（与上一条分别校验，见 adr-lifecycle.md 的 `deferred` 一节）：`deferred` 必带
  # 非空的全角括号注解。裸 `deferred` 答不出「搁置到什么时候、因为什么」，与这个状态要求
  # 可重启判据的性质自相矛盾；注解内容自由，惯例是「自何时起 + 缘由 + 由哪份 ADR 触发」。
  # 其余状态不受此条约束（注解始终可选）。
  if echo "$status" | grep -qE '^deferred(（|$)' && ! echo "$status" | grep -qE '^deferred（[^）]+）$'; then
    echo "::error file=${f}::状态 'deferred' 必须附全角括号注解（裸 deferred 非法；内容自由，惯例：自何时起 + 缘由 + 由哪份 ADR 触发）"
    fail=1
  fi

  # 日期字段
  if ! grep -qE '^- 日期: [0-9]{4}-[0-9]{2}-[0-9]{2}$' "$f"; then
    echo "::error file=${f}::缺少合法的 '- 日期: YYYY-MM-DD' 字段"
    fail=1
  fi

  # 角色字段
  if ! grep -qE '^- 角色: ' "$f"; then
    echo "::error file=${f}::缺少 '- 角色: ' 字段"
    fail=1
  fi

  # 必备章节
  for section in '## Context' '## Decision' '## Consequences' '## Revisit 条件'; do
    if ! grep -qF "$section" "$f"; then
      echo "::error file=${f}::缺少章节 '${section}'"
      fail=1
    fi
  done
done

# --- README 索引一致性（双向） ---

for f in docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
  base=$(basename "$f")
  if ! grep -qF "($base)" docs/adr/README.md; then
    echo "::error::docs/adr/README.md 索引缺少条目：$base"
    fail=1
  fi
done

# 索引中引用的每个文件必须存在
for ref in $(grep -oE '\(([0-9]{4}-[a-z0-9-]+\.md)\)' docs/adr/README.md | tr -d '()'); do
  if [ ! -f "docs/adr/$ref" ]; then
    echo "::error::docs/adr/README.md 索引指向不存在的文件：$ref"
    fail=1
  fi
done

# --- OpenSpec 制品相对链接可达性（实现见 scripts/openspec-links.sh） ---

if ! bash scripts/openspec-links.sh; then
  fail=1
fi

# --- OpenSpec 归档对账（实现见 scripts/openspec-archive-check.mjs） ---
# 挂本脚本而不是 gate.sh：本脚本是 docs-check.yml 与 gate.sh quick 共用的唯一制品门禁入口，
# 挂这里两边同时继承（REVIEW.md「同一语义两处真源」条）。该脚本的门禁模式同时判两件事：
# MODIFIED delta 的静默丢段面（第 4 条）与已完成 change 的归档队列条目（第 5 条）。
if ! command -v node >/dev/null 2>&1; then
  echo "::error::未找到 node，归档对账与验收覆盖表校验无法运行（环境要求见 README.md）"
  fail=1
else
  if ! node scripts/openspec-archive-check.mjs; then
    fail=1
  fi
  # 验收场景覆盖表（第 6 条）：生成物与场景 front-matter 的一致性 + 结构不变量。挂在本脚本上，
  # 本地 gate.sh quick 与 CI 的 docs-check.yml 同时继承（REVIEW.md「同一语义两处真源」条）。
  if ! node scripts/acceptance/coverage.mjs --check; then
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "docs-check: FAIL"
  exit 1
fi

echo "docs-check: PASS（ADR ${#files[@]} 份结构合法 + README 索引双向一致 + OpenSpec 相对链接可达 + 归档对账无静默丢段 + 归档队列齐备 + 验收覆盖表与场景一致）"
