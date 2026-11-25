---
id: "867-harness-skill-menu-ux-nov25"
item: 867
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
      ratio: 0.6
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
        ax: { has: "/acc-skill-00 " }
      - label: 未误选第二项
        ax: { not: "/acc-skill-01 " }
      - label: 接受后编辑器仍未变
        editor: { unchangedSince: doc-before-skill-nav }

  - name: 新建会话，准备从末项反向导航
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 再次聚焦空 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
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
        ax: { has: "/acc-skill-10 " }
      - label: 未误选末项
        ax: { not: "/acc-skill-11 " }
      - label: 整个键盘流程未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
---

本场景用 Enter 后的实际 ref 判定 Ctrl+N/P 的导航结果，不以「AX 里能看到 option 文本」冒充高亮或滚动位置断言。
长列表揭示与菜单外零滚动的逐拍几何矩阵在 `tests/visual/scenes/skill-hybrid.spec.ts`；真机截图供核对 WKWebView 的
高亮可见性与加宽形态。所有 Skill 与描述均为合成 fixture，不读取真实配置或真实 vault。
