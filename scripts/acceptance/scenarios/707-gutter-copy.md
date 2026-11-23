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
# chromium 场景以 `Clipboard.writeText` 拒绝注入覆盖。`⌥G` 是 **editor 作用域**命令：`do: open`
# 打开**已存在的标签**（含重启恢复的那一份）时焦点留在 chrome 上，按键不命中（spec 的已知边界①）
# ——每次 `⌥G` 前 MUST 先 `clickEditor` 并断言 `focused: AXTextArea`。change `global-line-numbers-toggle-nov23` 起
# md 与只读 code 共用 `[ui] line_numbers` 一个开关：本场景的启动口径是 `on`（两模式 gutter 常驻），
# 尾部再补一轮 `off` + `⌥G` 的临时 gutter 右键（两模式都不常驻时本手势唯一存在的形态）。
id: "707-gutter-copy"
item: 707
tier: full
title: 行号 gutter 右键复制 `{path}:{line}`——md（`line_numbers = on` / 合成 fixture 路径含空格与中文）与 code 首行、vault 外绝对路径、`off` + `⌥G` 的临时 gutter、剪贴板逐字、文档零写入
fixtures: ["gutter 空格 中文.md", "block-copy.txt"]
open: "gutter 空格 中文.md"
marker: "GUTTER-707-MARKER"
config:
  lineNumbers: on
steps:
  - name: 起点：md 文档已打开、gutter 常驻（`line_numbers = on`；数字不在 AX，截图是唯一的形态证据）
    do: settle
    expect:
      - label: 正向锚点——文档可读（fixture 首行 marker）
        editor: { has: "GUTTER-707-MARKER" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀）
        ax: { not: "（未保存）" }
      - label: 配置已落盘（本场景的 gutter 常驻来自启动口径，不是运行期命令）
        file: { path: env:config.json, has: "\"line_numbers\": \"on\"" }
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

  - name: 打开 code 文件（同一开关对 code 生效：`on` 档下 gutter 同样常驻）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
    expect:
      - label: code 文件已装载到前台
        ax: { has: "纯文本文件" }
      - shot: code-起点-gutter-常驻

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

  # off 档 + ⌥G 的临时 gutter（change global-line-numbers-toggle-nov23：两模式都不常驻时，
  # 本手势唯一存在的形态）。切启动口径为 off 并重启——这是启动真源的通道，不是运行期命令。
  - name: 切到 off 档并重启（启动真源 = config.json 的 [ui] line_numbers）
    do: configWrite
    lineNumbers: off
    expect:
      - label: 配置已落盘（off）
        file: { path: env:config.json, has: "\"line_numbers\": \"off\"" }

  - name: 重新打开 md 文档（off 档：gutter 不常驻）
    do: open
    file: gutter 空格 中文.md
    marker: "GUTTER-707-MARKER"
    expect:
      - label: 文档已装载
        editor: { has: "GUTTER-707-MARKER" }
      - shot: off-md-起点-无-gutter

  - name: 重建编辑器焦点（打开已存在的标签 / 重启后焦点留在 chrome 上，⌥G 是 editor 作用域）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: ⌥G 打开跳转输入条（临时 gutter 的唯一来源）
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场（截图外的唯一在读证据）
        ax: { has: '/AXTextField = "1"/' }
      - shot: off-md-临时-gutter

  - name: 右键临时 gutter 首行（md 系数；此时 gutter 由输入条带出）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.015, dy: 0.01 }
    expect:
      - label: 剪贴板逐字 = 路径 + 第 1 行（临时 gutter 与常驻 gutter 同一口径）
        clipboard: { exact: "gutter 空格 中文.md:1" }
      - label: 成功提示逐字回显
        ax: { has: "已复制 gutter 空格 中文.md:1" }
      - label: 右键的 mousedown 默认行为被消费 ⇒ 输入条仍开着、gutter 没有被 focusout 卸除
        ax: { has: '/AXTextField = "1"/' }
      - shot: off-md-临时-gutter-右键后

  - name: Escape 收起输入条（临时 gutter 随之卸除）
    do: key
    key: escape
    expect:
      - label: 输入条已收起
        ax: { not: "AXTextField" }

  - name: 打开 code 文件（off 档：同样不常驻）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
    expect:
      - label: code 文件已装载到前台
        ax: { has: "纯文本文件" }

  - name: 重建编辑器焦点（同上：⌥G 只在编辑器焦点下命中）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: ⌥G 在 code 模式打开输入条（临时 gutter 两模式一致）
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场
        ax: { has: "/AXTextField = \"1\"/" }

  - name: 右键 code 的临时 gutter 首行（code 系数与 md 不同——见文件头）
    do: click
    target: { role: AXTextArea, button: right, dx: -0.112, dy: 0.058 }
    expect:
      - label: 剪贴板逐字 = 路径 + 第 1 行
        clipboard: { exact: "block-copy.txt:1" }
      - label: 成功提示逐字回显
        ax: { has: "已复制 block-copy.txt:1" }
      - shot: off-code-临时-gutter-右键后
---
