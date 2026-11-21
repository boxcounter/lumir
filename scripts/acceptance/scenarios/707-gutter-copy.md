---
# change gutter-copy-path-line-nov21：行号 gutter 右键复制 `{path}:{line}` 的真机链路。
#
# 为什么这条判据只能在真机层：右键走真实指针事件（`contextmenu`），剪贴板是系统级副作用；
# Chromium 桩能判同一逻辑（tests/visual/scenes/gutter-copy-path-line.spec.ts），但 WKWebView 的
# 指针事件序与剪贴板权限面只有真机能证。
#
# 坐标口径（MUST 保持）：md / code 的行号数字**不在 AX 树里**（场景 56 的已登记边界），因此
# 右键落点取 `AXTextArea` bbox 的比例偏移（execute.mjs 的 click：px = bbox.x + w*dx）。两模式
# 的 gutter 落点不同，**不能共用一份系数**：
#   · md：gutter 贴在正文列左缘。`dx: -0.015` 落在正文列左缘之外约 1.5% 宽处（gutter 宽约
#     16–24px）；`dy: 0.01` 落在正文顶部留白，对应第 1 行。
#   · code：gutter 钉在编辑器面板左缘（`src/editor.ts` 的 code grid 里 `.cm-gutters` 是
#     `justifySelf: start`，md 的 gutter 则在 col 1 里 `justifySelf: end` 贴正文列）。两者之间
#     隔着整个 col 1 的剩余空白——md 的 -0.015 在 code 模式落进空白，弹 WKWebView 原生菜单
#     （Look Up / Translate），后续键入被菜单吃掉。1200×800 定窗的实测快照：AXTextArea
#     @577,72 1297×1251（截图 2048×1365），code gutter 首个行号中心约 (432,145) ⇒
#     `dx: (432-577)/1297 ≈ -0.112`、`dy: (145-72)/1251 ≈ 0.058`。
# 两轴都是比例而不是像素，不随字号 / 行高 / 窗口缩放漂（系数依赖定窗的栏宽；套件每场都把窗口
# 钉回 1200×800，见 README 的「窗口几何的确定性」）。
#
# 覆盖边界（如实登记）：剪贴板**权限拒绝**无法在真机稳定造出（系统授权框不可脚本化），那一面由
# chromium 场景以 `Clipboard.writeText` 拒绝注入覆盖；`off` / `on-demand` 档的 gutter 在场合同
# 由场景 56 与 m281 视觉场景覆盖，本场景只验 `always` 档（唯一能让 gutter 常驻的 md 档）与
# code 恒常显两态。
id: "707-gutter-copy"
item: 707
tier: full
title: 行号 gutter 右键复制 `{path}:{line}`——md（always / 合成 fixture 路径含空格与中文）与 code 首行、vault 外绝对路径、剪贴板逐字、文档零写入
fixtures: ["gutter 空格 中文.md", "block-copy.txt"]
open: "gutter 空格 中文.md"
marker: "GUTTER-707-MARKER"
config:
  markdownLineNumbers: always
steps:
  - name: 起点：md 文档已打开、gutter 常驻（`always` 档；数字不在 AX，截图是唯一的形态证据）
    do: settle
    expect:
      - label: 正向锚点——文档可读（fixture 首行 marker）
        editor: { has: "GUTTER-707-MARKER" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀）
        ax: { not: "（未保存）" }
      - label: 配置已落盘（本场景的 gutter 常驻来自启动口径，不是运行期命令）
        file: { path: env:config.json, has: "\"markdown_line_numbers\": \"always\"" }
      - shot: md-起点-gutter-常驻

  - name: 记录 md 磁盘基线（后面的零写盘断言比 sha256 + mtime）
    do: record
    file: gutter 空格 中文.md
    as: md-baseline

  - name: 右键 md gutter 首行（真实指针；坐标口径见文件头）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板是 vault 相对路径 + 1 基行号（无字面花括号）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - label: 成功提示逐字回显复制内容
        ax: { has: "已复制 gutter 空格 中文.md:1" }
      - shot: md-首行复制后

  - name: md 零写盘 / 无 dirty
    do: settle
    expect:
      - label: 文档逐字节与 mtime 都不变（右键只读）
        file: { path: gutter 空格 中文.md, unchangedSince: md-baseline, mtimeUnchangedSince: md-baseline }
      - label: 没有变 dirty
        ax: { not: "（未保存）" }

  - name: 打开 code 文件（code 模式 gutter 恒常显，不需要任何档位配置）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
    expect:
      - label: code 文件已装载到前台
        ax: { has: "纯文本文件" }
      - shot: code-起点-gutter-恒常显

  - name: 记录 code 磁盘基线
    do: record
    file: block-copy.txt
    as: code-baseline

  - name: 右键 code gutter 首行（code 的 gutter 钉在面板左缘，系数与 md 不同——见文件头）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板是 vault 相对路径 + 第 1 行（与 md 同一口径）
        clipboard: { exact: "block-copy.txt:1" }
      - label: 成功提示逐字回显
        ax: { has: "已复制 block-copy.txt:1" }
      - label: code 零写盘
        file: { path: block-copy.txt, unchangedSince: code-baseline, mtimeUnchangedSince: code-baseline }
      - shot: code-首行复制后
      - label: 没有弹 WKWebView 原生菜单（落进正文外空白时会出现 Look Up / Translate）
        ax: { not: "/AXMenuItem \\((?:Look Up|Translate)[^)]*\\)/" }

  - name: 原生菜单守卫——落点正确时立刻通过；弹了菜单就停在这里，别让它吃掉后面的键入
    do: waitFor
    waitFor:
      not: ["/AXMenuItem \\((?:Look Up|Translate)[^)]*\\)/"]
    timeoutMs: 3000

  - name: 用快速打开打开 vault 外只读文件（绝对路径口径）
    do: keys
    keys: ["cmd+p"]
  - name: 键入 /etc/hosts
    do: keys
    keys: ["/", "e", "t", "c", "/", "h", "o", "s", "t", "s"]
    expect:
      - label: 路径落进快速打开输入框
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: /etc/hosts/" }
  - name: 等直接行给出只读打开意图
    do: waitFor
    waitFor:
      has: ['/按 Enter 只读打开\s*\/etc\/\s*hosts/']
    timeoutMs: 5000
  - name: Enter 打开
    do: key
    key: enter
    expect:
      - label: 外部文件已打开（modeline 路径段是绝对路径；显示层把 / 换成「 / 」）
        ax: { has: "etc / hosts" }
      - label: 外部会话带「vault 外 · 只读」读法
        ax: { has: "vault 外 · 只读" }
      - shot: external-起点

  - name: 右键外部只读文档的 gutter 首行（外部文件同样是 code 模式，系数同上）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板是**绝对路径** + 第 1 行（MUST NOT 改写成 vault 相对路径）
        clipboard: { exact: "/etc/hosts:1" }
      - label: 成功提示逐字回显
        ax: { has: "已复制 /etc/hosts:1" }
      - label: 外部会话仍只读
        ax: { has: "vault 外 · 只读" }
      - shot: external-首行复制后
      - label: 没有弹 WKWebView 原生菜单（否则后续 ⌘P / 键入会被菜单吃掉）
        ax: { not: "/AXMenuItem \\((?:Look Up|Translate)[^)]*\\)/" }

  - name: 原生菜单守卫——弹了菜单就停在这里，不让后续 /etc/hosts 键入被菜单污染
    do: waitFor
    waitFor:
      not: ["/AXMenuItem \\((?:Look Up|Translate)[^)]*\\)/"]
    timeoutMs: 3000
---
