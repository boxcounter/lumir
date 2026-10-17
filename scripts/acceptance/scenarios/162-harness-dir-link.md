---
# change harness-dir-link 的真机判据：harness 输出里的 vault 目录引用可点，点击在左栏文件树里定位
# （展开祖先链 + 滚动 + 短暂高亮），**不打开文档、不切标签、不创建条目、目标目录自身不展开**。
# 高亮的节奏与观感由截图人工判读（套件没有行态读数），机器判据只覆盖「展开了 / 没打开 / 没新标签」。
id: "162-harness-dir-link"
item: 553
title: harness 输出里的 vault 目录引用可点击（左栏定位）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-dir-link.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 造目录与文件（目标目录 + 目标目录内的文件 + 同级的展开见证文件）
    do: vaultWrite
    file: "dir-link/nested-dir/keep.md"
    content: "# 目录定位目标\n\nDL-KEEP-MARK\n"

  - name: 同级见证文件（回复不引用它——它出现在 AX 里只可能来自祖先展开）
    do: vaultWrite
    file: "dir-link/peer.md"
    content: "# 目录定位见证\n\nDL-PEER-MARK\n"

  - name: 等 watch 增量把新条目送进树（外部写入没有 UI 信号，留一拍再发问）
    do: sleep
    ms: 1200

  - name: 点 composer 聚焦并输入提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|dlmark" }
    text: "dlmark"
    expect:
      - label: 提问落进 composer（注入落地的正观测）
        ax: { has: "dlmark" }
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答渲染完
    do: waitFor
    waitFor:
      has: ["目录定位验收"]
    timeoutMs: 30000

  - name: 点击前的形态：目录可点（含尾斜杠写法）、子行不在、无新标签
    do: settle
    expect:
      - label: 正文里的目录引用是可点元素（AXButton，名字 = 原文）
        ax: { has: "/AXButton \\(dir-link\\/nested-dir\\)/" }
      - label: 尾斜杠写法同样可点且展示文本保留尾斜杠
        ax: { has: "/AXButton \\(dir-link\\/nested-dir\\/\\)/" }
      - label: 不存在的目录不产出可点元素
        ax: { not: "/AXButton \\(dir-link\\/gone-dir\\)/" }
      - label: 左栏尚未展开——见证文件的行不在 AX 里（点击后的正观测从这里翻转）
        ax: { not: "/AXButton \\(dir-link\\/peer\\.md\\)/" }
      - label: 目标目录的内容也未显示（定位只展开祖先，不展开目标自身）
        ax: { not: "/AXButton \\(dir-link\\/nested-dir\\/keep\\.md\\)/" }
      - label: 目录点击没有打开任何文档（目标目录里的文件没有标签）
        ax: { not: "/AXRadioButton \\(keep\\.md\\)/" }
      - label: 点击前「dir-link/nested-dir」这个名字只出现在面板里（正文 + 工具卡片两个可点元素）
        ax: { count: { pattern: "AXButton \\(dir-link/nested-dir\\)", exact: 2 } }
      - shot: 01-点击前的形态

  - name: 点击正文里的尾斜杠目录引用（同时验证归一：可见文本带斜杠、定位路径不带）
    do: click
    target: { role: AXButton, name: "^dir-link/nested-dir/$" }

  - name: 等左栏展开落地（见证文件的行出现 = 祖先链已展开）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(dir-link/peer\\.md\\)/"]
    timeoutMs: 15000

  - name: 定位后的判据：祖先展开、目标自身仍折叠、无新标签、编辑器不变
    expect:
      - label: 祖先展开——同级见证文件的行出现在左栏
        ax: { has: "/AXButton \\(dir-link\\/peer\\.md\\)/" }
      - label: 目标目录的行进入左栏（同名可点元素由 2 变 3：正文 + 工具卡片 + 树行）
        ax: { count: { pattern: "AXButton \\(dir-link/nested-dir\\)", exact: 3 } }
      - label: 目标目录自身没有被展开（其内容行不出现）
        ax: { not: "/AXButton \\(dir-link\\/nested-dir\\/keep\\.md\\)/" }
      - label: 没有打开文档、没有新标签（目录点击只定位）
        ax: { not: "/AXRadioButton \\(keep\\.md\\)/" }
      - label: 前台仍是原来的文档标签
        ax: { has: "/AXRadioButton \\(harness-note\\.md\\) Value: true/" }
      - label: 编辑器内容不变（原文档仍在正文里）
        editor: { has: "HNL-ALPHA" }
      - shot: 02-左栏定位与短暂高亮

  - name: 再点一次同一条尾斜杠引用（重复定位：幂等，不折叠、不重复展开）
    do: click
    target: { role: AXButton, name: "^dir-link/nested-dir/$" }

  - name: 重复定位后形态不变
    do: settle
    expect:
      - label: 见证文件的行仍在（重复定位不折叠祖先）
        ax: { has: "/AXButton \\(dir-link\\/peer\\.md\\)/" }
      - label: 目标目录仍保持折叠（定位从不展开目标自身）
        ax: { not: "/AXButton \\(dir-link\\/nested-dir\\/keep\\.md\\)/" }
      - label: 仍然没有新标签
        ax: { not: "/AXRadioButton \\(keep\\.md\\)/" }
---
 
# 162-harness-dir-link —— 输出里的 vault 目录引用 → 左栏定位（change harness-dir-link）

## 本场景在验什么

Alex 2026-10-17 的裁决（逐字）：「如果命名的是目录，那么点击效果是在左栏里定位到。」本场景用 mock
provider 铺开目录引用的三种形态与点击后的四条行为：

1. **目录可点**：`dir-link/nested-dir`（普通写法）与 `dir-link/nested-dir/`（尾斜杠写法）都上屏为
   `<button>`；尾斜杠逐字留在可见文本里。工具卡片上由结构化参数取得的目录路径（`vault_read` 的
   `path`）同样可点——它与正文共用同一份判定与分发。
2. **点击 = 左栏定位**：展开祖先 `dir-link`（见证 = 同级文件 `peer.md` 的行出现），目标目录行进入
   左栏；**目标目录自身不展开**（其内容行 `keep.md` 不出现）、**不打开文档 / 不新增标签**（没有
   `keep.md` 的标签，前台仍是 `harness-note.md`）、编辑器内容不变。
3. **反向形态**：不存在的目录 `dir-link/gone-dir` 保持纯文本。
4. **幂等**：重复点击同一条引用不折叠、不重复展开、不产生标签。

## 判据为什么这样写

- **展开用「同级见证文件」判**：目标目录行的读屏名与面板里的可点元素同名（都是 `dir-link/nested-dir`），
  单看它无法区分「树里出现了这一行」与「面板里那个按钮还在」。`dir-link/peer.md` 不在回复里，它出现在
  AX 里只可能来自祖先展开——这是判别性最强的正观测。
- **同名元素计数**：点击前 `AXButton (dir-link/nested-dir)` 恰 2 个（正文链接 + 工具卡片链接），
  点击后恰 3 个（再加树行）——把「树行真的进了 DOM」钉成机器判据，同时证明卡片上的目录路径也
  被链接化（卡片的点击分发与正文同一条代码路径，由正文那次点击覆盖）。
- **目标自身不展开**用 `keep.md` 的内容行不在 AX 里判：它是目标目录的子行，只有「展开目标」才会出现。
- **不打开 / 不切标签**用 `AXRadioButton (keep.md)` 不存在 + `harness-note.md` 仍 `Value: true` +
  `editor.has` 原文档正文三条一起判（与场景 161 的新标签判据同口径）。
- **重复定位**一步验证「定位从不折叠」这条语义（树上的点击是 toggle，定位不是）。

## 覆盖边界（如实登记）

- **高亮的节奏与观感没有机器判据**：`02-左栏定位与短暂高亮` 的截图只证明「定位后左栏形态正确」，
  约 1.2s 的 `--sel` 淡出由 `tests/unit/tree-reveal.test.ts` 的假计时器用例钉住，实际观感归 Alex
  手感裁决。点击步骤没有 `settleMs`，截图尽量落在高亮窗口内（首轮轮询即刻返回），但不把「截到了
  高亮」写成断言。
- **惰性目录的子孙目录**（树里从没取回过的深层目录）保持纯文本——与文件侧「惰性文件不进索引」同源的
  已知边界，本场景不造现场。
- **工具卡片上的目录路径**：真机判据覆盖「它被链接化」（同名元素计数里含卡片；`vault_read` 在 mock
  provider 下不会真的读盘），点击分发与正文共用同一条路径（正文那次点击覆盖）；分发的单测用例在
  `tests/unit/harness-transcript-render.test.ts`。
- **样例全合成**：目录名、文件名、正文标记都是为验收编的合成串，不含真实 vault 内容。
