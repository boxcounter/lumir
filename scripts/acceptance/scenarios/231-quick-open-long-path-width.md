---
# Quick Open 独立响应式宽度的真机判据：⌘P 的输入面在 WKWebView 下按
# clamp(26em,50vw,56em) 展开、不再被 26em 约定宽挤住。
#
# 为什么这条判据只能在真机层：字体是系统 WKWebView 的 -apple-system / PingFang SC，字形宽度与
# chromium 有 <3% 差异（M698 §8）；「600px 的盒子在真机上够不够放下典型路径」这种边界读数只有
# 真机截图 + 几何读数能答。chromium 层（tests/visual/scenes/m702-overlay-width.spec.ts）判行内
# 两段结构与文本，判不了真机字形下的实际宽度。
#
# 判据的落点：输入框是浮层里唯一有稳定 AX 名字的节点（AXComboBox「按路径快速打开文件」）——
# 它的宽度 = 浮层宽 − 2×(border + 12px margin)。26em 旧档下输入框 ≈ 287 截图px，新 50vw 档下
# ≈ 551（本机截图相对窗口是 0.96 倍：1200pt 窗口 → 1152px 截图）。故 minWidth 450 是这一条的
# 区分度阈值（旧 26em 形态 ≈287 < 450 必红；新形态 ≈551 过线）。
#
# 不覆盖（如实登记）：目录前缀的省略号是绘制层形态，AX 读不到；「文件名完整」由 chromium 的
# 结构断言（.lumir-qo-dirs 出省略号 + .lumir-qo-name 不溢出）与 title 全路径承担。
id: "231-quick-open-long-path-width"
item: 702
tier: full
title: 快速打开浮层宽度：长路径下输入面按 50vw 响应式档展开、路径全文仍在 AX 里
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 造一条 60 字符以上的深层路径（合成 fixture；watcher 收进索引后候选可见）
    do: vaultWrite
    file: areas/work/clients/acme/2026/q4/meetings/2026-10-24-kickoff-notes-final-v2.md
    content: "# Kickoff\n\nDEEP-702-MARKER\n"

  - name: 焦点在编辑器，⌘P 唤起输入面
    do: clickEditor
  - name: 按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 输入面出现且输入框持焦
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }

  - name: 输入深路径的文件名片段
    do: keys
    keys: ["k", "i", "c", "k", "o", "f", "f"]
    expect:
      - label: 查询串落进输入框
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: kickoff/" }

  - name: 等候选列表出现（索引收编 / 探测落定）
    do: waitFor
    waitFor:
      has: ["2026-10-24-kickoff-notes-final-v2.md"]
    timeoutMs: 15000

  - name: 宽度与全文现场
    do: settle
    expect:
      - label: 候选行的文本是完整相对路径（不是被裁的尾段——title 与文本内容都是全文）
        ax: { has: "areas/work/clients/acme/2026/q4/meetings/2026-10-24-kickoff-notes-final-v2.md" }
      - label: 输入面宽度（26em 旧档下输入框 ≈287 截图px；50vw 新档下 ≈551）——几何 + 绘制两段
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          minWidth: 450
          minHeight: 18
          painted: { min: 30 }
      - shot: 01-长路径候选

  - name: Esc 收起
    do: key
    key: escape
---

spec 判据（change `add-quick-open-directory-stable-nov25`）：⌘P 使用独立的
`clamp(26em,50vw,56em)` + `max-width:calc(100vw - 28px)`，MUST NOT 随查询或候选变化；TOC 仍沿用
`overlay-width-contract-oct24` 的 26em 档。行的截断方向 SHALL 保住文件名（目录前缀可中段省略），
全路径 MUST 有 `title` 兜底。

M698 实测（`.local/reports/m698-overlay-width-audit-oct24.md` §3.1）：旧定值 300px 下，
77 字符的深层路径固有宽 488px，**裁掉 42.5%——文件名整段不可见**；本场景用同一量级的
路径（67 字符）在真机上判「输入面确实变宽了」这一半，另一半（文件名不被尾省略吃掉）由
chromium 结构断言承担。
