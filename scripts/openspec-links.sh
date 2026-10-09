#!/usr/bin/env bash
# scripts/openspec-links.sh — OpenSpec 制品内相对链接的可达性检查。
#
# 背景（docs/backlog.md 的 M256 节「归档不重写相对链接、目录深度 +1 无门禁」）：
# `openspec archive` 把 change 目录移进 `archive/<日期>-<id>/`（深一层）却不重写制品内的相对
# 链接，而 `openspec validate` 不查链接可达性、docs-check.sh 此前只覆盖 docs/adr ⇒ 归档留下的
# 死链既无机器门禁、也无人核对（M150 修 17 处、M253 修 25 处、M331 修 27 处，都是事后扫尾）。
# 本脚本把这条判据补成机器门禁。
#
# 判据：遍历 openspec/**/*.md 的每一条 markdown 相对链接（图片 `![](…)` 同等对待），把目标拼到
# 制品所在目录，在磁盘上 exists() 校验；不可达的逐行打印（CI 上同时是 ::error:: 注解）并以 1 退出。
#
# 三类目标不计入检查，各有来历（除此之外没有豁免名单、没有 allowlist）：
#   1. 带 scheme（http/https/mailto/…）的外链与 `#` 纯锚点——外部目标不在本仓；
#   2. **行内代码跨度与围栏代码块内**的链接——markdown 渲染器不把它们渲染成链接，它们是正文里
#      描述链接语法的示意例子（如 `attachment-display/spec.md` 里 Scenario 正文的
#      `![截图](./assets/shot.png)`）。M155 坐实过这类误报，处置口径是「示意例子写进行内代码」
#      （docs/backlog.md 的 M155 节）；
#   3. **非路径形态**的裸占位词（无目录分隔符且末段无扩展名，如 `[title](link)`、`[配置](配置)`）
#      ——同为正文里的示意例子，docs/backlog.md 的 M155 节把 `[配置](配置)` 直接点名为要排除的形态。
#
# 依赖：纯 bash + find/awk/sort，不引入新依赖（CI 的 docs-check.yml 直接 `bash` 调本脚本，
# ubuntu runner 无需额外安装）。
set -euo pipefail
cd "$(dirname "$0")/.."

# 一趟 awk 抽出候选链接（剥掉不渲染为链接的上下文 + 三类跳过），输出 `文件<TAB>行号<TAB>目标`。
# 放在 awk 里而不是逐行起 grep/sed：352 份制品约 3 万行，逐行起进程会让本脚本耗时一分钟以上。
candidates() {
  awk '
    FNR == 1 { in_fence = 0 }
    { line = $0 }
    /^[ \t]*(```|~~~)/ { in_fence = !in_fence; next }
    in_fence { next }
    {
      # 抹去行内代码跨度（`` `…` ``），使其中内容不再被当作链接
      out = ""; s = line
      while ((p = index(s, "`")) > 0) {
        rest = substr(s, p + 1)
        q = index(rest, "`")
        if (q == 0) break
        out = out substr(s, 1, p - 1) " "
        s = substr(rest, q + 1)
      }
      s = out s
      # 抽 `](目标)`，目标截到第一个 `)` / 空格 / 制表符
      while ((p = index(s, "](")) > 0) {
        rest = substr(s, p + 2)
        n = length(rest); cut = n + 1
        for (i = 1; i <= n; i++) {
          c = substr(rest, i, 1)
          if (c == ")" || c == " " || c == "\t") { cut = i; break }
        }
        target = substr(rest, 1, cut - 1)
        s = substr(rest, cut)
        if (target != "") print FILENAME "\t" FNR "\t" target
      }
    }
  ' "$@"
}

fail=0
checked=0
broken=0

while IFS=$'\t' read -r f n t; do
  [ -n "$t" ] || continue
  # 角括号包裹的目标（`[x](<https://…>)`）：先剥括号再判 scheme
  case "$t" in
    '<'*'>') t=${t#<}; t=${t%>} ;;
  esac
  # 带 scheme 的外部目标 / 非白名单协议（javascript: / file: / 应用协议）一律跳过
  if [[ "$t" =~ ^[A-Za-z][A-Za-z0-9+.-]*: ]]; then continue; fi
  case "$t" in '#'*) continue ;; esac
  clean=${t%%#*}
  [ -n "$clean" ] || continue
  # 非路径形态的裸占位词（无 `/` 且末段无扩展名）→ 正文示意例子，跳过
  case "$clean" in
    */*) ;;
    *)
      case "${clean##*/}" in
        *.*) ;;
        *) continue ;;
      esac
      ;;
  esac
  checked=$((checked + 1))
  if [ ! -e "$(dirname "$f")/$clean" ]; then
    echo "::error file=${f},line=${n}::相对链接目标不存在：${t}"
    broken=$((broken + 1))
    fail=1
  fi
done < <(candidates $(find openspec -type f -name '*.md' | LC_ALL=C sort))

if [ "$fail" -ne 0 ]; then
  echo "openspec-links: FAIL（${broken} 条不可达 / 共校验 ${checked} 条相对链接）"
  exit 1
fi

echo "openspec-links: PASS（校验 ${checked} 条相对链接，全部可达）"
