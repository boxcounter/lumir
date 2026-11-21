---
# mission harness-navigation-nov21 的真机判据（缺陷修复，承接 change fix-harness-navigation-nov21）：
# harness 输出里「句末英文句号紧跟行号后缀」的形态——`{path}:{line}.` / `{path}:{start}-{end}.`
# ——行号后缀必须成立：可点元素的名字是**整段含后缀**（不是退化成裸路径），点击落到目标行。
# 反证：小数形态 `{path}:{line}.{digit}`（`decimal-note.md:3.5`）仍是畸形后缀，只链接路径本身。
#
# 落点位置（是否居中、是否高亮）由截图人工判读：AXTextArea.value 是整个文档文本，套件没有
# scrollTop 读数，也读不到装饰类名（与场景 161 / 221 同一已知边界，见「覆盖边界」一节）。
id: "269-harness-path-line-sentence-period"
item: 705
tier: full
title: 句末句号不吞行号（path:line. 仍是整段可点并落到目标行）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-path-line-sentence-period.json"
steps:
  - name: 造一个小数形态的对照文件（vault 内、可点，但不是行号引用的宿主）
    do: vaultWrite
    file: "decimal-note.md"
    content: "# 小数对照\n\nDECIMAL-NOTE-LINE-01\n第 2 行\n第 3 行\n"

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 点 composer 聚焦并输入提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|sentmark" }
    text: "sentmark"
    expect:
      - label: 提问落进 composer（注入落地的正观测）
        ax: { has: "sentmark" }

  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答渲染完
    do: waitFor
    waitFor:
      has: ["句末句号验收"]
    timeoutMs: 30000

  - name: 收起左栏（裸路径负向断言只应看 Harness，不应误伤文件树里的同名 fixture）
    do: key
    key: "cmd+b"
    expect:
      - label: 文件树已退出 AX 树
        ax: { not: "点击查看全部 vault" }

  - name: 句末句号形态的可点性
    do: settle
    expect:
      # 正向：句号留在可点范围之外，后缀（含行号）在按钮名字里。
      - label: 单行形态整段是一个可点元素（名字 = path:12，句号不进可点范围）
        node: { role: AXButton, name: "^path-link-target\\.md:12$", present: true }
      # 反证：不存在退化成裸路径的按钮（缺陷形态：行号被句号吞掉）。
      - label: 没有退化成裸路径的按钮（行号没有被句号吞掉）
        node: { role: AXButton, name: "^path-link-target\\.md$", present: false }
      # 既有行范围形态不回归。
      - label: 行范围形态整段是一个可点元素
        node: { role: AXButton, name: "^path-link-target\\.md:16-18$", present: true }
      # 小数形态仍是畸形后缀：只链接路径本身。
      - label: 小数形态只链接路径本身（`.5` 不是句末标点）
        node: { role: AXButton, name: "^decimal-note\\.md$", present: true }
      - label: 小数形态没有被当成行号引用
        node: { role: AXButton, name: "^decimal-note\\.md:3\\.5$", present: false }
      - shot: 01-句末句号可点性

  - name: 点单行链接（新标签打开目标文件并落到第 12 行；截图留给落点人工判读）
    do: click
    target: { role: AXButton, name: "^path-link-target\\.md:12$" }
    expect:
      - shot: 02-落到第 12 行（目标行应在视口内；滚动位置由截图判读）

  - name: 等目标文件装载
    do: waitFor
    waitFor:
      has: ["PL-LINE-12-TARGET"]
    timeoutMs: 15000
    expect:
      - label: '目标文件在**新标签**里且成为前台（AXRadioButton 的 Value: true）'
        ax: { has: '/AXRadioButton \(path-link-target\.md\) Value: true/' }
      - label: 原标签仍在（新标签意图，不是替换当前标签）
        ax: { has: '/AXRadioButton \(harness-note\.md\)/' }
      - label: 目标文件正文已装载（第 12 行原文在场）
        editor: { has: "PL-LINE-12-TARGET" }
      - label: 正文没有被点击改写（只跳转、不编辑）
        ax: { has: "PL-LINE-01-START" }
---

# 269-harness-path-line-sentence-period —— 句末句号不吞行号

## 本场景在验什么

mission harness-navigation-nov21 的第一个缺陷：harness 输出里 agent 写「见 `design.md:69.`」时，
句末英文句号被 `lineSuffixAt` 的后缀后置守卫当成「路径延续字符」，整个 `:69` 后缀被拒——
链接退化成 `design.md`，点击只开到文件第 1 行，行号静默丢失（用户看到的形态就是「点击行号不解析」）。

修复后本场景钉住三件事：

1. `path-link-target.md:12.` 的可点元素名字是**整段含后缀**（`^path-link-target\.md:12$`）；
2. 不存在退化成裸路径 `path-link-target.md` 的按钮（缺陷形态的反证）；
3. 小数形态 `decimal-note.md:3.5` 仍按畸形后缀处理（只链接路径本身）——修复没有放宽「路径还在
   继续」的边界。

## 判据为什么这样写

- **用 `node` 而不是 `ax.has`**：`ax.has` 在整棵 AX 树文本上匹配，正文里的同名字串会让正向断言
  恒绿、负向断言恒红（README 的 `node` 条）。按钮名字与正文是两种事实，必须按节点判。
- **正向 + 反证成对**：只写「`path:12` 按钮在场」不足以区分「修复生效」与「正文里恰好出现这串
  文本」；`^path-link-target\.md$` 的 `present: false` 是缺陷形态的判别性反证（旧代码上它判红）。
- **小数形态的反向对照**：修复把「`.` 后紧跟数字」留在拒绝侧；如果实现改成无条件接受 `.`，
  这一条会红。

## 覆盖边界（如实登记）

- **落点是否居中、是否带瞬态高亮没有机器判据**：AX 读不到 scrollTop 与装饰类名（场景 221 的同一
  已知边界）；`02` 截图由人判读。
- **解析边界矩阵**（句号 / 省略号 / 行范围 / 行列 / 小数 / 字母 / 斜杠）在
  `tests/unit/harness-path-link.test.ts`；渲染面（链接文本、点击落行、高亮行集合）在
  `tests/visual/scenes/harness-navigation-nov21.spec.ts`。
- **样例全合成**：文件名与正文标记都是验收用合成串，不含真实 vault 内容。
