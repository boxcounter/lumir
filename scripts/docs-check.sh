#!/usr/bin/env bash
# scripts/docs-check.sh — ADR 制品门禁的唯一实现。
# 本地 `scripts/gate.sh quick` 与 CI 的 .github/workflows/docs-check.yml 调的是同一份脚本：
# 「本地全绿才允许提交」要求本地跑的就是 CI 跑的那条命令，两处各写一遍必然漂移
#（M153；REVIEW.md 第 8 条：同一语义不要两处真源）。
#
# 校验内容（口径本体见 docs/process/adr-lifecycle.md）：
#   1. docs/adr/ 下每份 ADR 的文件结构、状态字段、日期与角色字段、必备章节
#   2. docs/adr/README.md 索引与 ADR 文件双向一致
# 输出：失败时逐条打印问题（CI 上同时是 ::error:: 注解）并以 1 退出。
#
# 注意：OpenSpec 侧的校验不在这里——权威实现是 `openspec validate --all --strict`
#（CI 的 docs-check.yml 与本地 gate.sh 都调它，两者同一命令），故无需在此复制一遍。
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

if [ "$fail" -ne 0 ]; then
  echo "docs-check: FAIL"
  exit 1
fi

echo "docs-check: PASS（ADR ${#files[@]} 份结构合法 + README 索引双向一致）"
