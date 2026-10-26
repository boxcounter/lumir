#!/usr/bin/env bash
# scripts/acceptance/check-syntax.sh — 验收套件语法层：scripts/acceptance 入口与 lib/*.mjs 逐文件
# `node --check`。
#
# 唯一实现：本地 quick 与 docs-check.sh（CI）都经 scripts/acceptance/check-suite.sh 调这一份，
# 不各写一遍（REVIEW.md「同一语义两处真源」条）。
#
# 为什么需要这一层：真机跑批不进 CI；没有这一层，lib 的语法错要等下一次真机跑批才暴露，整批起不来。
#
# 边界：`--check` 只解析、不执行——不 import 模块图、不起 app、不建验收锁、不碰验收 vault，
# 也不占 `LUMIR_ACCEPTANCE_PORT`，故与真机跑批的实例 / 端口隔离无关；它也不查 import 解析
#（模块缺失 / 导出名错）与类型，只管语法。
#
# 输出：通过时打印「acceptance-syntax: N 个文件通过 node --check」（PASS 也留可 grep 的证据）；
# 任一文件语法错即以 1 退出，node 的 SyntaxError 留在调用方日志里。
set -euo pipefail
cd "$(dirname "$0")/../.."

n=0
for f in scripts/acceptance/*.mjs scripts/acceptance/lib/*.mjs; do
  node --check "$f"
  n=$((n + 1))
done
echo "acceptance-syntax: ${n} 个文件通过 node --check"
