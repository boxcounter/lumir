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
  - name: 合成路径前缀 Skill（/tmp 不得误调用）
    do: vaultWrite
    file: .agents/skills/tmp-acc/SKILL.md
    content: |
      ---
      description: 路径前缀对照
      ---
      TMP-ACC-BODY
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
  - name: 打开即有自动视觉游标（首项），Ctrl+N 两次到第三项
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
    gapMs: 120
    expect:
      - label: 导航后候选仍在且正文未变
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 02-Ctrl-N-第三项
  - name: Ctrl+P 回第二项
    do: key
    key: "ctrl+p"
    expect:
      - label: 反向导航仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 03-Ctrl-P-回第二项
  - name: Enter 接受第二项
    do: key
    key: enter
    expect:
      - label: 自动游标 00 起、两次下一项接一次上一项得到 acc-skill-01
        ax: { has: '/AXTextArea = "/acc-skill-01"/' }
      - label: 未误选首项
        ax: { not: '/AXTextArea = "/acc-skill-00"/' }
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
  - name: Ctrl+N 逐项走到末项（十一拍），末项再按一次停住
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    gapMs: 90
    expect:
      - label: 逐项导航仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
      - label: 末项已完整滚入真实可见带（截图证据；几何断言在视觉套件）
        shot: 04-滚动到末项-末项应完整可见
  - name: Ctrl+P 回到倒数第二项
    do: key
    key: "ctrl+p"
    expect:
      - label: 末段回退仍未改编辑器
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 04b-末段导航-倒数第二项应完整可见
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

  - name: 新建会话，准备全名自动接受
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦空 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，避免指针悬停替用户武装
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 逐字键入完整 Skill 名 acc-skill-05
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-skill-05" }
    text: "/acc-skill-05"
    expect:
      - label: 候选仍显示（全名命中不关闭候选）
        ax: { has: "AXList (Select a Skill)" }
      - shot: 04c-全名自动武装
  - name: 全名态 Enter 直接接受
    do: key
    key: enter
    expect:
      - label: 全名接受后候选关闭
        ax: { not: "AXList (Select a Skill)" }
      - label: 未接受相邻 Skill
        ax: { not: '/AXTextArea = "/acc-skill-04"/' }
      - label: 编辑器仍未变
        editor: { unchangedSince: doc-before-skill-nav }
  - name: 接受后继续键入一个字符，证明 token 之后留了空格
    do: keys
    keys: ["x"]
    expect:
      - label: 完整名之后留空格，后续输入另起一词（没留空格会拼成 /acc-skill-05x）
        ax: { has: '/AXTextArea = "/acc-skill-05 x"/' }
      - label: 继续输入不重新打开候选
        ax: { not: "AXList (Select a Skill)" }
      - shot: 04d-全名接受后留空格

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

  - name: 新建会话，准备 /tmp 路径前缀对照
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 聚焦空 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 移开指针，避免指针悬停替用户武装
    do: hover
    target: { role: AXRadioButton, name: "^harness-note.md$" }
  - name: 键入 /tmp，唯一候选只做视觉预选
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/tmp" }
    text: "/tmp"
    expect:
      - label: 路径前缀仍显示被动候选
        ax: { has: "AXList (Select a Skill)" }
      - shot: 10b-tmp-路径前缀只做视觉预选
  - name: Enter 发送普通文本而不是接受 tmp-acc
    do: key
    key: enter
    expect:
      - label: 候选不得把被动态 Enter 变成一次 Skill 调用
        ax: { not: '/AXTextArea = "/tmp-acc"/' }
      - label: 普通文本被当成消息发出（transcript 出现 /tmp）
        node: { role: AXStaticText, name: "^/tmp$", present: true }
      - label: 候选已关闭
        ax: { not: "AXList (Select a Skill)" }
      - label: 编辑器仍未变
        editor: { unchangedSince: doc-before-skill-nav }
      - shot: 10c-tmp-发送后现场
---

本场景用 Enter 后的实际 ref 判定 Ctrl+N/P 的导航结果，不以「AX 里能看到 option 文本」冒充高亮或滚动位置断言。
全名接受写入的是 `/名字 `（带尾随空格，见 `tests/unit/skill-menu.test.ts` 对 `skillSelectionSpec` 的断言与
`tests/visual/scenes/skill-hybrid.spec.ts` 的全名用例），但**真机 AX 的 `AXTextArea = "…"` 会把值尾的空白裁掉**
（同场景「Enter 接受第二项」按 `/acc-skill-01` 无空格判 PASS，走的是同一条插入路径），因此尾随空格不能靠
「期望值里写一个空格」来证明——那条断言在任何实现下都恒红。改为接受后继续键入一个字符：留了空格才会得到
`/acc-skill-05 x`，没留则是 `/acc-skill-05x`，同一个判据同时锁住「空格」与「caret 落在空格之后」。同理 `/tmp`
那一步的负向断言不再把空格写进判据串（旧写法 `"/tmp-acc "` 在裁掉空白的 AX 里永不可能命中，是恒真断言），
改成 `not "/tmp-acc"` 与「transcript 里出现普通消息 `/tmp`」一正一负成对。
长列表揭示、菜单外零滚动、修饰键 `defaultPrevented`、候选高亮与 20% 窄 pane 不越界的逐拍机器判据在
`tests/visual/scenes/skill-hybrid.spec.ts`；真机 AX 读不到这些 DOM 事实，因此 868 用选区替换结果验证
Shift/Ctrl+Shift 的原生路径，用候选存续验证 Meta、用精确组字结果验证 Alt，并用截图保留两者和窄 pane 现场，
不把截图描述成已通过的像素断言。
所有 Skill 与描述均为合成 fixture，不读取真实配置或真实 vault。
