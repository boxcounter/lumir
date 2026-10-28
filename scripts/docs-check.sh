#!/usr/bin/env bash
# scripts/docs-check.sh — 制品门禁的唯一实现（docs/adr/ 的结构与索引 + openspec 相对链接可达性
# + 验收场景静态契约与覆盖表 + 验收套件自测）。
# 本地 `scripts/gate.sh quick` 与 CI 的 .github/workflows/docs-check.yml 调的是同一份脚本：
# 「本地全绿才允许提交」要求本地跑的就是 CI 跑的那条命令，两处各写一遍必然漂移
#（M153；REVIEW.md 「同一语义两处真源」条：同一语义不要两处真源）。
#
# 校验内容（口径本体见 docs/process/adr-lifecycle.md）：
#   1. docs/adr/ 下每份 ADR 的文件结构、状态字段、日期与角色字段、必备章节
#      - 状态值合法（合法集合见下），与「deferred 必带全角括号注解」**两条分别校验**
#        （adr-lifecycle.md 的 `deferred` 一节定稿口径：裸 deferred 非法）
#   2. docs/adr/README.md 索引与 ADR 文件双向一致
#   3. openspec/**/*.md 内相对链接的可达性（实现在 scripts/openspec-links.sh，本脚本调它）。
#      归档加深一层目录造成的死链由写侧包装器 scripts/openspec-archive.mjs 在 archive 时就地最小修复
#      （只改「当前不可达且前加一层 ../ 可达」的目标，判红/判绿仍归 links 判据）；包装器的 fixture 自测
#      `node --test scripts/openspec-archive.test.mjs` 也挂在本脚本里跑。
#   4. OpenSpec 归档对账：活跃 change 的 MODIFIED delta 是否静默删掉了 living spec 的段落
#      （实现在 scripts/openspec-archive-check.mjs，本脚本调它——`openspec archive` 对 MODIFIED 是
#      整块替换，delta 少抄的段落在归档时静默消失，validate 与链接检查都看不见）
#   5. 归档队列：tasks 全勾的活跃 change 是否在 docs/backlog.md 有且仅有一条归档跟踪条目
#      （同一脚本的门禁模式顺带判；口径见 docs/process/openspec-workflow.md「批次收尾 checklist」）
#   6. 验收场景契约与覆盖表：全部 scenarios/*.md 经 checkScenario 静态校验，COVERAGE.md 与
#      front-matter 一致，id / item / title 必填、id 唯一、item 在覆盖表内一项一行（场景间共用 item 合法）。
#   7. docs/backlog.md 出口门禁：待修 / 已立项 / 待真机验收区出现完成标记（已修 / 已核销 / 已落地 /
#      已收口…）仍留条目、活项缺下一动作 / 关闭条件、同一 finding 指针重复、finding 指针不存在、
#      记录在案无 canonical 指针 / 复核口径、全文超 80 行 ⇒ FAIL；条目年龄只进报告不判红（实现
#      在 scripts/backlog-check.mjs，本脚本调它——规则出处是 Alex 2026-10-24 裁决与
#      docs/process/openspec-workflow.md「backlog 出口的机器判据」节）；判据的区分度测试
#      `node --test scripts/backlog-check.test.mjs` 同样挂在本脚本里跑（M789 补挂——此前该测试
#      只出现在注释里、全仓无执行者，判据与测试脱钩不会让任何门禁变红）。
#   8. 验收套件语法与自测：scripts/acceptance 入口与 lib/*.mjs 逐文件 `node --check`，并执行
#      check-suite.sh 清单内的 node:test 自测（清单真源是该脚本本身，这里不抄组数——抄一次漂一次）。
#      第 6 / 8 条统一走 scripts/acceptance/check-suite.sh；不起 app、不占端口、不碰验收 vault。
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

# --- 归档链接修复包装器的自测（实现见 scripts/openspec-archive.mjs / .test.mjs） ---
# 包装器是 `openspec archive` 的唯一入口（docs/process/openspec-workflow.md「归档后的强制完成步骤」）：
# 归档后按「当前不可达且前加一层 ../ 可达」最小修复相对链接，其它一律不动。判据自身的区分度测试
# 与 openspec-archive-check.test.mjs 同址同跑法，挂本脚本 ⇒ 本地 gate.sh quick 与 CI 的
# docs-check.yml 同时继承（REVIEW.md「同一语义两处真源」条）。
if ! command -v node >/dev/null 2>&1; then
  echo "::error::未找到 node，归档修链包装器自测无法运行（环境要求见 README.md）"
  fail=1
elif ! node --test scripts/openspec-archive.test.mjs; then
  echo "::error::归档修链包装器自测失败（node --test scripts/openspec-archive.test.mjs）"
  fail=1
fi

# --- OpenSpec 归档对账（实现见 scripts/openspec-archive-check.mjs） ---
# 挂本脚本而不是 gate.sh：本脚本是 docs-check.yml 与 gate.sh quick 共用的唯一制品门禁入口，
# 挂这里两边同时继承（REVIEW.md「同一语义两处真源」条）。该脚本的门禁模式同时判两件事：
# MODIFIED delta 的静默丢段面（第 4 条）与已完成 change 的归档队列条目（第 5 条）。
if ! command -v node >/dev/null 2>&1; then
  echo "::error::未找到 node，归档对账 / 验收套件契约 / backlog 出口无法运行（环境要求见 README.md）"
  fail=1
else
  if ! node scripts/openspec-archive-check.mjs; then
    fail=1
  fi
  # backlog 出口门禁（第 7 条）：完成标记 / 缺出口 / 重复或死 finding 指针 / 记录在案无 canonical
  # 居所 / 80 行硬上限。规则出处见 docs/process/openspec-workflow.md「backlog 出口的机器判据」。
  if ! node scripts/backlog-check.mjs; then
    fail=1
  fi
  # backlog 判据的区分度测试（M789）：与 openspec 两处自测同址同跑法——判据实现改了测试没跟上、
  # 或测试自身腐烂，都在这里判红。此前该测试全仓无执行者，只出现在注释里。
  if ! node --test scripts/backlog-check.test.mjs; then
    echo "::error::backlog 出口门禁自测失败（node --test scripts/backlog-check.test.mjs）"
    fail=1
  fi
  # 验收套件契约（第 6 / 8 条）：语法、全部场景静态校验、覆盖表与套件自测共用唯一入口，
  # 本地 gate.sh quick 的 acceptance-suite 门调同一份（REVIEW.md「同一语义两处真源」条）。
  if ! bash scripts/acceptance/check-suite.sh; then
    echo "::error::验收套件契约检查失败（实现 scripts/acceptance/check-suite.sh）"
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "docs-check: FAIL"
  exit 1
fi

echo "docs-check: PASS（ADR ${#files[@]} 份结构合法 + README 索引双向一致 + OpenSpec 相对链接可达（含归档修链包装器自测）+ 归档对账无静默丢段 + 归档队列齐备 + 验收场景契约与覆盖表一致 + backlog 出口合规（含判据自测）+ 验收套件语法与自测通过）"
