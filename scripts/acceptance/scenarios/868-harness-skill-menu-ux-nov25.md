---
id: "868-harness-skill-menu-ux-nov25"
item: 868
tier: full
title: Skill 候选：Ctrl+N/P 同方向键、长列表高亮揭示与响应式加宽（change fix-skill-menu-ux-nov25）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-skill.json"
seed:
  registry:
    - { id: acc-skill-ux, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-skill-ux:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.8
      harnessPane: true
steps:
  - name: 合成 Skill 00（长描述用于宽度证据）
    do: vaultWrite
    file: .agents/skills/acc-skill-00/SKILL.md
    content: |
      ---
      description: 合成 Skill 00 的长描述，用于验证候选在正常 pane 中按可用空间加宽，而不是挤在旧的小菜单里。
      ---
      ACC-SKILL-00-BODY
  - name: 合成 Skill 01
    do: vaultWrite
    file: .agents/skills/acc-skill-01/SKILL.md
    content: |
      ---
      description: 合成 Skill 01 描述
      ---
      ACC-SKILL-01-BODY
  - name: 合成 Skill 02
    do: vaultWrite
    file: .agents/skills/acc-skill-02/SKILL.md
    content: |
      ---
      description: 合成 Skill 02 描述
      ---
      ACC-SKILL-02-BODY
  - name: 合成 Skill 03
    do: vaultWrite
    file: .agents/skills/acc-skill-03/SKILL.md
    content: |
      ---
      description: 合成 Skill 03 描述
      ---
      ACC-SKILL-03-BODY
  - name: 合成 Skill 04
    do: vaultWrite
    file: .agents/skills/acc-skill-04/SKILL.md
    content: |
      ---
      description: 合成 Skill 04 描述
      ---
      ACC-SKILL-04-BODY
  - name: 合成 Skill 05
    do: vaultWrite
    file: .agents/skills/acc-skill-05/SKILL.md
    content: |
      ---
      description: 合成 Skill 05 描述
      ---
      ACC-SKILL-05-BODY
  - name: 合成 Skill 06
    do: vaultWrite
    file: .agents/skills/acc-skill-06/SKILL.md
    content: |
      ---
      description: 合成 Skill 06 描述
      ---
      ACC-SKILL-06-BODY
  - name: 合成 Skill 07
    do: vaultWrite
    file: .agents/skills/acc-skill-07/SKILL.md
    content: |
      ---
      description: 合成 Skill 07 描述
      ---
      ACC-SKILL-07-BODY
  - name: 合成 Skill 08
    do: vaultWrite
    file: .agents/skills/acc-skill-08/SKILL.md
    content: |
      ---
      description: 合成 Skill 08 描述
      ---
      ACC-SKILL-08-BODY
  - name: 合成 Skill 09
    do: vaultWrite
    file: .agents/skills/acc-skill-09/SKILL.md
    content: |
      ---
      description: 合成 Skill 09 描述
      ---
      ACC-SKILL-09-BODY
  - name: 合成 Skill 10
    do: vaultWrite
    file: .agents/skills/acc-skill-10/SKILL.md
    content: |
      ---
      description: 合成 Skill 10 描述
      ---
      ACC-SKILL-10-BODY
  - name: 合成 Skill 11
    do: vaultWrite
    file: .agents/skills/acc-skill-11/SKILL.md
    content: |
      ---
      description: 合成 Skill 11 描述
      ---
      ACC-SKILL-11-BODY
  - name: 等外部 Skill 写入 watcher 收敛
    do: sleep
    ms: 1200
  - name: 真实点击 composer 建立键盘焦点
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
    expect:
      - label: composer 已持焦
        ax: { focused: "AXTextArea" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 输入共同前缀，打开十二项长列表
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
    expect:
      - label: 候选列表与长描述已出现
        ax: { has: "合成 Skill 00 的长描述" }
      - shot: 01-长列表与响应式宽度
  - name: 记录编辑器文档基线（导航不得漏进正文）
    do: recordEditor
    as: doc-before-skill-nav
  - name: Ctrl+N 两次到第二项
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
    gapMs: 120
    expect:
      - label: 导航后候选仍在且正文未变
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 02-Ctrl-N-第二项
  - name: Ctrl+P 回第一项
    do: key
    key: "ctrl+p"
    expect:
      - label: 反向导航仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 03-Ctrl-P-回第一项
  - name: Enter 接受第一项
    do: key
    key: enter
    expect:
      - label: 两次下一项接一次上一项得到 acc-skill-00
        ax: { has: '/AXTextArea = "/acc-skill-00"/' }
      - label: 未误选第二项
        ax: { not: '/AXTextArea = "/acc-skill-01"/' }
      - label: 接受后编辑器仍未变
        editor: { unchangedSince: doc-before-skill-nav }

  - name: 新建会话，准备从末项反向导航
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 再次聚焦空 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 再次打开同一长列表
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
    expect:
      - label: 第二份候选已出现
        ax: { has: "合成 Skill 00 的长描述" }
  - name: Ctrl+P 从被动态到末项，Ctrl+N 在末端停住，再 Ctrl+P 到倒数第二项
    do: keys
    keys: ["ctrl+p", "ctrl+n", "ctrl+p"]
    gapMs: 120
    expect:
      - label: 末段导航后编辑器仍未变
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 04-末段导航-倒数第二项应完整可见
  - name: Enter 接受倒数第二项
    do: key
    key: enter
    expect:
      - label: 末项停住后回退一项得到 acc-skill-10
        ax: { has: '/AXTextArea = "/acc-skill-10"/' }
      - label: 未误选末项
        ax: { not: '/AXTextArea = "/acc-skill-11"/' }
      - label: 整个键盘流程未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }

  - name: 新建会话，准备 Shift+Arrow 原生选区对照
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦 Shift+Arrow 对照 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 打开 Shift+Arrow 对照候选
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
  - name: Shift+ArrowUp 关闭候选并保留原生扩选
    do: key
    key: "shift+up"
    expect:
      - label: 原生扩选使 caret 离开 Skill token 后候选关闭，事件未被候选消费
        ax: { not: "合成 Skill 00 的长描述" }
      - shot: 05-Shift-Arrow-原生扩选
  - name: 用替换选区的可见结果证明 Shift+Arrow 未被候选消费
    do: keys
    keys: ["z"]
    expect:
      - label: 原生选区被 z 替换，而不是候选导航后保留原文
        ax: { has: '/AXTextArea = "z"/' }
      - label: 替换后候选保持关闭
        ax: { not: "合成 Skill 00 的长描述" }
      - label: Shift 对照仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }

  - name: 新建会话，准备 Ctrl+Shift 原生选区对照
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦 Ctrl+Shift 对照 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 打开 Ctrl+Shift 对照候选
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
  - name: Ctrl+Shift+P 关闭候选但保留原生扩选
    do: key
    key: "ctrl+shift+p"
    expect:
      - label: Ctrl+Shift 沿旧路径关闭候选
        ax: { not: "合成 Skill 00 的长描述" }
      - shot: 06-Ctrl-Shift-原生扩选
  - name: 用替换选区的可见结果证明 Ctrl+Shift+P 未被候选消费
    do: keys
    keys: ["z"]
    expect:
      - label: Ctrl+Shift 原生选区同样被 z 替换
        ax: { has: '/AXTextArea = "z"/' }
      - label: Ctrl+Shift 对照仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }

  - name: 新建会话，准备 Meta 对照
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦 Meta 对照 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 打开 Meta 对照候选
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
  - name: Meta+N 不关闭候选，截图保留真实高亮状态
    do: key
    key: "cmd+n"
    expect:
      - label: Meta 组合不走 Ctrl+N 的候选导航与关闭路径
        ax: { has: "AXList (Select a Skill)" }
      - shot: 07-Meta-N-候选高亮现场
  - name: 关闭 Meta 对照候选
    do: key
    key: escape
    expect:
      - label: Meta 对照后 Escape 合同仍在
        ax: { not: "合成 Skill 00 的长描述" }

  - name: 新建会话，准备 Alt 对照
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦 Alt 对照 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 打开 Alt 对照候选
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
  - name: Alt+N 走 macOS 原生组字，不被候选导航消费
    do: key
    key: "alt+n"
    channel: cgevent
    expect:
      - label: Alt+N 的原生组字精确落入 composer
        ax: { has: '/AXTextArea = "/acc-skill˜"/' }
      - label: 组字改变 query 后候选关闭，未产生候选导航
        ax: { not: "AXList (Select a Skill)" }
      - label: Alt 对照仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 08-Alt-N-原生组字现场
  - name: Alt 组字后 Escape 关闭对话面板
    do: key
    key: escape
    expect:
      - label: 对话面板已关闭
        ax: { has: "AXCheckBox (对话面板) Value: 0" }
      - label: Alt 对照候选保持关闭
        ax: { not: "AXList (Select a Skill)" }
  - name: 重开对话面板，准备 20% 窄 pane 对照
    do: click
    target: { role: AXCheckBox, name: "^对话面板$" }

  - name: 新建会话，seed 已固定文档侧 80% 与 harness 20%
    do: click
    target: { role: AXButton, name: "新会话" }
    expect:
      - label: 会话文件确认文档侧 80%（AX 读不到栏宽，盘上是比例事实源）
        file: { path: "env:vault-sessions/acc-skill-ux.json", has: '"pane_split_ratio": 0.8' }
      - shot: 09-harness-20pct-窄-pane
  - name: 聚焦 20% 窄 pane composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，确保候选从无 hover 的被动态打开
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 20% 窄 pane 打开长描述候选并保留几何现场截图
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill" }
    text: "/acc-skill"
    expect:
      - label: 窄 pane 候选真实出现
        ax: { has: "合成 Skill 00 的长描述" }
      - shot: 10-harness-20pct-候选几何现场
---

本场景用 Enter 后的实际 ref 判定 Ctrl+N/P 的导航结果，不以「AX 里能看到 option 文本」冒充高亮或滚动位置断言。
长列表揭示、菜单外零滚动、修饰键 `defaultPrevented`、候选高亮与 20% 窄 pane 不越界的逐拍机器判据在
`tests/visual/scenes/skill-hybrid.spec.ts`；真机 AX 读不到这些 DOM 事实，因此 868 用选区替换结果验证
Shift/Ctrl+Shift 的原生路径，用候选存续验证 Meta、用精确组字结果验证 Alt，并用截图保留两者和窄 pane 现场，
不把截图描述成已通过的像素断言。
所有 Skill 与描述均为合成 fixture，不读取真实配置或真实 vault。
