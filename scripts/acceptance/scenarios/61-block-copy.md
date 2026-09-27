---
id: "61-block-copy"
item: 61
title: 块级复制：表格复制含表头分隔行的源码、代码块复制纯内容（围栏行与语法缩进都不在结果里）、降级表与 code 模式不命中不消费、不改写源文件
fixtures: [block-copy.md, block-copy.txt]
open: block-copy.md
marker: "块级复制场景"
config:
  keys: { "Cmd-j": "block.copy" }
# caret 的落点策略（M277 现场试了五版才定，读数逐条留在 test-results/acceptance/m277/）：
#   - **唯一可靠的可点锚点是表格的 AXTable**：块内文本节点与图表 widget 在 AX 里都不带 bbox
#     （实测三种目标都报「找不到带 bbox 的节点」，见 zz-probe2 的现场）。
#   - 长 chain（8–19 个 chord）在盲发注入下会丢键 ⇒ 只允许 4–7 步的短链，且每个目标块 4–6 行
#     ⇒ 单次丢键（±1 步）仍落在块内。
#   - 落点一律由「剪贴板等于哪一块的源码」反证。
# fixture 行号：1..4 = mermaid 块（编辑器首行 ⇒ 一次点击即可进块，零 chain）｜8 = 正文段落｜
# 12..15 = grid 表｜17..20 = 缩进块｜22..27 = 围栏块｜29..31 = 非矩形表。
steps:
  # fixture 行号（见下注）：1..4 = mermaid 块｜8 = 正文段落｜12..15 = grid 表｜17..20 = 缩进块｜
  # 22..27 = 围栏块｜29..31 = 非矩形表。
  - name: 终态：mermaid 块、grid 表、缩进块、围栏块、非矩形表都在场
    expect:
      - label: 唯一一张 grid 表在场（表格复制的靶子，也是后两段 chain 的锚点）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: 非矩形表整块回退的归因文案在场（fixture 第 31 行）
        ax: { has: "第 31 行单元格数与表头不符（应为 2 列）" }
      - label: 围栏块的内容在 AX 里
        ax: { has: "const alpha" }
      - label: 缩进块的内容在 AX 里
        ax: { has: "indented four" }
      - shot: 终态

  - name: 基线：记录编辑器内容与磁盘文件
    do: recordEditor
    as: before
    expect:
      - label: 磁盘基线可记（文件在验收 vault 里）
        file: { path: block-copy.md, exists: true }
  - name: 基线：记录磁盘 sha256
    do: record
    file: block-copy.md
    as: doc

  # ---- 正观测①：mermaid 图表态（点编辑器首行 = 图表本体，零 chain） ----
  - name: caret 进 mermaid 块：点编辑器首行（图表本体）
    do: clickEditor
    dx: 40
    dy: 6
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 抢前台（同机另有一个 Lumir 实例在跑时后台注入的 chord 会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: 执行 block.copy（⌘J 发两次：命令幂等，同内容写两次换取一次丢键的容错）
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 等反馈落定（剪贴板写入与 toast 上屏都是异步的；读之前先 settle）
    do: settle
    expect:
      - label: 剪贴板 = mermaid 源码（图表态没有钮、但命令路径仍命中——这是那条设计决定的正观测）
        clipboard:
          exact: |-
            graph TD;
              Start-->Stop;
      - label: 成功反馈是代码块那一条
        ax: { has: "已复制代码块" }
      - shot: mermaid 复制后

  # ---- 正观测②：表格（点 AXTable 把 caret 放进表内） ----
  - name: caret 进表：点表格中央
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 执行 block.copy（表格）
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 等反馈落定
    do: settle
    expect:
      - label: 剪贴板逐字节等于该表在文档里的源码（含表头分隔行与对齐填充，无尾换行）
        clipboard:
          exact: |-
            | 名称 | 值 |
            | ---   | ---: |
            | 甲 | 1 |
            | 乙 | 22 |
      - label: 成功反馈是同词的成功 toast（与上一条配对：单看剪贴板会被上一次的残留骗过）
        ax: { has: "已复制表格" }
      - shot: 表格复制后

  # ---- 正观测③：缩进代码块（从表格锚点走 4 步；块跨 17..20） ----
  - name: caret 进缩进块：重新点表格锚点后下移 4 行
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
  - name: 下移到缩进块（⌃N × 4 ⇒ 第 18 行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 执行 block.copy（缩进块）
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 等反馈落定
    do: settle
    expect:
      - label: 剪贴板 = 剥掉语法缩进的纯内容（`deeper` 那行仍是 4 空格）
        clipboard:
          exact: |-
            indented one
                deeper
            indented three
            indented four
      - label: 成功反馈是代码块那一条（配上一条：防「上一步的残留恰好等于期望值」的假绿）
        ax: { has: "已复制代码块" }
      - shot: 缩进块复制后

  # ---- 正观测④：围栏代码块（从缩进块走 6 步；块跨 22..27） ----
  - name: 下移到围栏块（⌃N × 6 ⇒ 第 24 行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 执行 block.copy（围栏块）
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 等反馈落定
    do: settle
    expect:
      - label: 剪贴板逐字节等于纯内容（围栏行与语言标记都不在结果里，无尾换行）
        clipboard:
          exact: |-
            const alpha = 1;
              if (alpha) {
                beta();
              }
      - label: 成功反馈是代码块那一条
        ax: { has: "已复制代码块" }
      - shot: 围栏块复制后

  # ---- 负对照：非矩形表（从围栏块走 5 步；源码跨 29..31） ----
  - name: 负对照：caret 下移到非矩形表的源码行（⌃N × 5 ⇒ 第 30 行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 负对照：在非矩形表里执行同一条命令
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 负对照：等一拍再读
    do: settle
    expect:
      - label: 剪贴板仍是围栏块的内容（非矩形表不是可复制块）
        clipboard:
          exact: |-
            const alpha = 1;
              if (alpha) {
                beta();
              }
      - label: 文档未落盘改写（磁盘 sha256 与基线相同）
        file: { path: block-copy.md, unchangedSince: doc }
      - shot: 非矩形表里执行命令后

  # ---- 负对照：code 模式（非 md 文件） ----
  - name: 打开非 md 文件（code 模式）
    do: open
    file: block-copy.txt
    marker: "纯文本文件"
  - name: 焦点进编辑器（不给焦点则「不命中」会因为键没送到而假绿）
    do: clickEditor
    dx: 40
    dy: 6
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 在 code 模式里执行同一条命令
    do: keys
    keys: ["cmd+j", "cmd+j"]
  - name: 负对照：等一拍再读
    do: settle
    expect:
      - label: 剪贴板仍是上一次那一段（code 模式没有可复制块）
        clipboard:
          not: "graph TD"
      - shot: code-模式里执行命令后

  # 收尾前切回 md fixture（下一条断言比的是它的磁盘 sha256）。
  - name: 收尾：切回 md fixture
    do: open
    file: block-copy.md
    marker: "块级复制场景"
    expect:
      - label: 回到 md 文档
        ax: { focused: "AXTextArea" }

teardown:
  - label: 收尾：md fixture 的磁盘 sha256 与基线相同（ADR 0003 §3——「不改写源文件」的机器判据）
    file: { path: block-copy.md, unchangedSince: doc }
---
# 块级复制（M277，change `block-copy-affordance`）

Alex 原话（2026-09-27）：「markdown 文件里的表格和代码块支持『复制』。」

## 这个场景验什么

复制动作的**内容口径**（本 change 唯一有真值风险的地方）与**命中边界**，走真机 WKWebView 的
按键 → 系统剪贴板闭环：

| 块 | 期望结果 | 为什么 |
|---|---|---|
| 渲染为 grid 的 pipe 表 | 该表在文档里的**源码**（含表头分隔行与对齐填充、无尾换行） | 渲染态隐藏了表头分隔行；用户要的是「文档里的写法」 |
| 围栏代码块 | **纯内容**（围栏行与语言标记不在结果里） | 诉求原话「复制纯内容」 |
| 缩进代码块 | 纯内容（剥掉「它是代码块」那层 4 空格语法缩进，保留 `deeper` 那行的相对缩进） | 同一句用户口径 |
| 非矩形 / 降级表 | **不命中**：剪贴板保持上一次的值、文档不变 | 它们没有 grid DOM，不是可复制块（结构性） |
| mermaid 图表态 | **命令路径仍命中**（复制源码） | 钮挂在源码行上，图表态没有可挂点；命令判据是模型级的 |
| code 模式（非 md 文件） | **不命中** | 没有 live preview 装饰层、没有「块」这个对象 |

## 判据的分层与各层边界（如实登记）

- **内容逐字节正确**只在这一层可判：剪贴板既不在 AX 也不在磁盘，套件的 `clipboard: { exact }`
  是唯一逐字判据（M244 的场景 47 同款）。剪贴板读数**已做行尾归一**（`lib/execute.mjs` 的
  `readClipboard`：AppleScript 按经典 Mac 行尾 CR 返回粘贴板文本，不归一多行 `exact` 必然假红）。
- **caret 落点只走「一次点击 + 4–7 步短链」**：块内文本节点与图表 widget 在 AX 里都没有 bbox
  （M277 现场实测），因此唯一可点的锚点是表格的 `AXTable`；长 chain 会丢键，所以 fixture 把各块
  排成「只隔一个空行」，每段链 4–7 步、每个目标块 4–6 行（单次丢键仍落在块内）。落点由
  「剪贴板等于哪一块的源码」反证。
- **每一步都配一条正向见证**：单独的 `clipboard.exact` 会被「上一次的残留恰好等于期望值」骗过
  （M277 第三轮实测：某一步真的没落地，而剪贴板里的旧值正是它期望的那一份）。因此每次复制都
  同时断言**成功 toast**，两条负对照（非矩形表、code 模式）则改判「剪贴板仍是上一步那一块的内容」。
- **「caret 在普通段落里不命中」本场景未覆盖**（如实登记）：本场景的 caret 只能靠「点编辑器首行」
  或「点表格锚点 + 短链」到达，首行在这里是 mermaid 块（不是段落）⇒ 纯段落落点没有稳定通道。
  该判据由 chromium 场景 `tests/visual/scenes/m277-block-copy.spec.ts` 的 5.3f
  （caret 落进段落 → 同键 → 剪贴板不变 + 文档不变，随后在同一份文档的表格里同键成功作正观测）覆盖。
- **⌘J 发两次**：`block.copy` 幂等（同一段文本写两次、toast 重复一条），用一次冗余换一次丢键的
  容错。判据始终是逐字节相等 + toast 在场，不是「重试次数」。
- **触发钮的鼠标路径本场景未覆盖**：套件动作表里没有 `hover` / `mouseMove`（M240 场景 40 的
  同款边界）。钮的 hover 时机、两钮共存的几何、点击后的剪贴板内容由 chromium 场景
  `tests/visual/scenes/m277-block-copy.spec.ts` 覆盖；真机侧只验命令路径。
- **同机若有第二个 Lumir 实例在跑，chord 注入会丢键**（REVIEW.md 第 11 条）：本场景每个命令
  注入前都显式 `focusWindow`；仍丢键时按该条纪律**先复跑一次**再判缺陷。
- **不改写源文件**：`editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言（ADR 0003 §3）。
