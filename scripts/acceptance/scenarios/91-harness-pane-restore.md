---
id: "91-harness-pane-restore"
item: 91
title: harness_pane 随 vault 往返恢复：启动装配出面板（空会话）、切走不泄漏、切回按存储重建
fixtures: [tabs-a.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [tabs-a.md], active: tabs-a.md }
      ratio: 0.6
      # harness_pane = true：上一个会话里 harness 面板在场 ⇒ 恢复时按存储重新装配面板
      # （ADR 0008 Decision 6 的 Phase 2 消费位；会话内容不持久化，恢复出**空会话**）。
      harnessPane: true
steps:
  - name: 等启动恢复落定（文档标签 + harness pane 一起恢复）
    do: waitFor
    waitFor:
      has: ["分隔条", "标签场景 A", "/AXButton \\(发送\\)/"]
    timeoutMs: 40000
    expect:
      - shot: 01-A-启动恢复
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 恢复的是**空会话**（transcript 空态提示在场——会话内容不持久化）
        ax: { has: "与当前文档对话" }
      - label: 文档标签一并恢复（一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 恢复的正文是 A 的 tabs-a
        editor: { has: "标签场景 A" }
      - label: 会话文件里 harness_pane 位为真（恢复的来源）
        file: { path: "env:vault-sessions/acc-a.json", has: '"harness_pane": true' }

  # ⌘O 是**盲发 chord**（套件对 chord 不做回读重试，见 README「已知边界」），紧随其后的 AX 读取
  # 会与「按键被 app 处理」那一拍抢——M296 首跑的现场（场景 17 已登记）就是这个错位。因此按键与
  # 断言分成两步，中间用 `waitFor` 等浮层的可观测终态。
  - name: ⌘O 打开 vault 列表（盲发 chord）
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }
      - shot: 02-vault-浮层

  - name: 点 B 行——切到另一个 vault
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等 B 装载跑完
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  - name: B 没有存储的 harness 布局——面板不随 A 泄漏过来
    do: settle
    expect:
      - shot: 03-B-无-harness
      - label: A 的分栏拓扑不残留到 B（分隔条不在）
        ax: { not: "分隔条" }
      - label: 面板轨道不泄漏（发送钮不在）
        ax: { not: "/AXButton \\(发送\\)/" }

  - name: ⌘O 再打开列表（盲发 chord）
    do: key
    key: "cmd+o"
  - name: 等浮层重新出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
    expect:
      - label: 浮层里 A 的行在位（不带 -b 后缀的那一行）
        ax: { has: "/lumir-m102-acceptance /" }
  - name: 点 A 行（`名称 + 空格` 锚定，排除 `-b` 那一行——与场景 17 同一手法）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }

  - name: 等 A 重新装载（面板与标签一起回来）
    do: waitFor
    waitFor:
      has: ["分隔条", "标签场景 A"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
    expect:
      - shot: 04-A-切回
      - label: harness pane 按 A 的存储重建（往返成立）
        ax: { has: "分隔条" }
      - label: 面板重建（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 重建出的是空会话（内容不持久化）
        ax: { has: "与当前文档对话" }
      - label: 文档标签也随会话恢复
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 恢复的正文是 tabs-a
        editor: { has: "标签场景 A" }
---

# 91-harness-pane-restore —— harness_pane 的按 vault 持久化与往返恢复（tasks 1.4 / 6.2）

## 本场景在验什么

`harness_pane` 是 ADR 0008 Decision 6 登记的契约位（`src-tauri/src/vault_session.rs` 的
`VaultSession.harness_pane`）：会话落盘时记「harness 面板在场与否」，恢复时据此重新装配面板。
**会话内容不持久化**（内存态），恢复出的是空会话。本场景验三件事：

1. **启动恢复**：预置的会话带 `harness_pane: true` ⇒ 启动后 harness 面板按存储装配成旁侧
   pane（分隔条 + 面板在位），transcript 是空态。
2. **切走不泄漏**：切到没有存储布局的 vault B ⇒ A 的分栏拓扑不残留（分隔条与面板都不在）——
   `applyStoredLayout(harnessPane=false)` 会收起 harness pane。
3. **切回按存储重建**：从 B 切回 A ⇒ 面板与文档标签一起按 A 的会话恢复（往返成立）。

## 断言口径

- **面板在场** = D368 分隔条在位 + `AXButton (发送)` 在场（与场景 86 同源）。
- **空会话** = transcript 空态提示「与当前文档对话」（D346）在场——它是「transcript 没有子
  节点」的构造性判据（`syncEmptyHint`，与场景 78 同口径）：提示在场即证明恢复出的是空会话，
  也同时是「A 的旧对话没有随存储回流」的正观测。
- **会话文件**：`env:vault-sessions/acc-a.json` 的 `harness_pane` 位是断言的来源（预置值）；
  文档标签的恢复用「关闭钮计数 = 1」+ 正文串判。
- **切回 A 的行**：浮层行文本形如 `<路径> N 个标签 · …`，用 `/lumir-m102-acceptance /`
  （名称后紧跟**空格**）锚定**不带 `-b`** 的那一行——`-b` 那一行的同位置是 `-`（与场景 17
  同一手法，两行名字互为前缀的陷阱见那条场景）。

## 已知边界

- **面板的宽度比（`pane_split_ratio`）不在本场景判**：预置了 0.6 但恢复路径只保证「比例被
  读入并施加」，栏宽的像素事实 AX 读不到；比例判据在场景 86（默认值）与分隔条拖拽族。
- **会话内容跨启动不保留**是设计口径（非缺陷）：恢复只重建面板在场位，transcript 从空开始
  （ADR 0008 Decision 6 的明账）。
- **无历史文件的旧 v2 会话**：缺 `harness_pane` 字段按 false 解释（Rust 侧 serde default），
  那条兼容分支在 `src-tauri/src/vault_session.rs` 单测里覆盖（本场景预置的是显式 true）。

## 环境与副作用

- 两个合成 vault（`/tmp/lumir-m102-acceptance` 与 `-b`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault
  只读。预置注册项 acc-a / acc-b 指向它们（`$vault` / `$vault2` 记号）。
- 只切 vault 与读布局，不写 vault 文件；会话文件落在隔离配置目录下。1420 全程不碰。
