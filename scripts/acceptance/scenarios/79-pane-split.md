---
id: "79-pane-split"
item: 79
title: 双栏 pane——⌥S 分栏（新 pane 空态）/ ⌥O 往返切活跃 / ⌥S 上限二无操作 / ⌥W 收起并入 / 跨 pane 打开已开文件是移动
fixtures: [tabs-a.md, tabs-b.md]
open: tabs-a.md
marker: "标签场景 A"
steps:
  - name: 单 pane 常态（无分隔条、modeline 有当前文件）
    do: settle
    expect:
      - shot: 单 pane
      - label: 编辑器装载 tabs-a
        editor: { has: "标签场景 A" }
      - label: 单 pane 没有分隔条（D368 的读屏名只在分栏态出现——这是「在不在分栏」的唯一结构证据）
        ax: { not: "分隔条" }
      - label: modeline 有当前文件
        ax: { not: "无当前文件" }
      - label: 一个标签（一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: ⌥S 分栏——出现分隔条、新 pane 成为活跃且为空（pane.split 的默认键位）
    do: key
    key: "alt+s"
    expect:
      - shot: 分栏
      - label: 分隔条出现（分栏成立）
        ax: { has: "分隔条" }
      - label: 新 pane 成为活跃 pane——空 pane 无前台文件 ⇒ modeline 回「无当前文件」（原文案 D207）
        ax: { has: "无当前文件" }
      - label: 标签没有被复制到新 pane（原标签仍在，只此一个）
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: ⌥O 把活跃 pane 切回左边（pane.other 往返之一）
    do: key
    key: "alt+o"
    expect:
      - shot: 切回左 pane
      - label: 活跃 pane 换回有文件的那一个（modeline 重新有当前文件）
        ax: { not: "无当前文件" }
      - label: 分隔条仍在（切活跃不收起 pane）
        ax: { has: "分隔条" }

  - name: ⌥O 再切回右边（空 pane）——往返成立
    do: key
    key: "alt+o"
    expect:
      - label: 又回到空 pane
        ax: { has: "无当前文件" }
      - label: 标签数不变
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: 已达上限二时再按 ⌥S —— 无操作（不出现第三个 pane）
    do: key
    key: "alt+s"
    expect:
      - shot: 上限二再分栏
      - label: 仍是分栏（分隔条在），且没有第三 pane 的结构
        ax: { has: "分隔条" }
      - label: 活跃 pane 不变（仍是空 pane）
        ax: { has: "无当前文件" }
      - label: 标签数不变
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  # 跨 pane 打开已开文件 = 移动而非复制（pane-layout 的「会话所有权」）。活跃 pane 此刻是右边
  # 空 pane；从树里点已在左 pane 打开的 tabs-a —— 标签整体迁到右 pane 并成为其前台。
  # 本步**不给 marker**：`do: open` 的 marker 等待读的是 AX 里**第一个** AXTextArea（= 左 pane，
  # 此刻为空），内容落到右 pane 时它永远等不到（见下方「已知边界」）。断言放在下一步 settle 之后。
  - name: 活跃 pane 为右（空）时，从树里打开已在左 pane 的 tabs-a
    do: open
    file: tabs-a.md

  - name: 移动落到右 pane（移动不复制、不丢标签）
    do: settle
    expect:
      - shot: 跨 pane 移动
      - label: 标签总数仍为 1 —— 打开已开文件是移动，不是新开第二个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 移动后 tabs-a 成为右 pane 的前台（modeline 不再是「无当前文件」）
        ax: { not: "无当前文件" }
      - label: 仍在分栏态
        ax: { has: "分隔条" }

  - name: ⌥W 收起活跃 pane —— 全文标签并入另一 pane，回到单 pane
    do: key
    key: "alt+w"
    expect:
      - shot: 收起
      - label: 分隔条消失（回到单 pane 常态）
        ax: { not: "分隔条" }
      - label: 标签仍在（收起是并入，不丢标签）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 单 pane 有当前文件
        ax: { not: "无当前文件" }
---
# 79-pane-split —— 双栏 pane 容器（change pane-system-split-view，M319 tasks 7.1）

## 本场景在验什么

pane 容器的**行为面**（`pane.split` / `pane.other` / `pane.close` 三条命令 + 活跃 pane 语义）
在 `src/main.ts` 装配层与 `src/pane-layout.ts` 账本。本场景走真机通道，验只有在真实
WKWebView + 真实键盘下才成立的事：

1. **默认键位**：`⌥S` 分栏、`⌥O` 切活跃、`⌥W` 收起——三条经真机键盘注入落地（它们是 M319 的
   键位指配，见 `src/keys.ts` 的 `Alt-KeyS` / `Alt-KeyO` / `Alt-KeyW`）。
2. **分栏的可见结果**：分隔条出现（`role=separator` + 读屏名 D368）、新 pane 为活跃且空
   （modeline 读「无当前文件」）。
3. **`pane.other` 往返**：活跃 pane 在两侧之间切换，modeline 跟随活跃 pane 的**前台**换源。
4. **上限二无操作**：已是双 pane 时 `⌥S` 不产生第三个 pane。
5. **跨 pane 打开已开文件是移动**：活跃 pane 为右（空）时从树里打开已在左 pane 的文件，
   标签总数保持 1（移动不复制）。
6. **`pane.close` 标签并入**：`⌥W` 收起活跃 pane，标签按序并入另一 pane，回到单 pane 常态。

## 断言口径与「分隔条」为什么是分栏的唯一结构证据

- **在不在分栏**：用 `ax: { has/not: "分隔条" }`——「分隔条」一词只在 D368（分隔条的读屏名）
  里出现，单 pane 时该元素根本不建（`createPaneHandle` 只在非 root pane 分支建它）。
- **活跃 pane 是谁**：用 modeline 的左段路径（`syncDirtyIndicator`）。空 pane 无前台文件 ⇒
  读 D207「无当前文件」；有文件 ⇒ 读 vault 相对路径。`⌥O` 往返靠它证「活跃指针真的翻了」。
- **标签总数**：用「关闭钮读屏名」计数（每个标签恰一个关闭钮，读屏名 `关闭 <文件名>`），
  口径与场景 14 同源。跨 pane 移动的判据是「打开已开文件后总数仍为 1」。

## 已知边界（本场景**不**覆盖什么，以及为什么）

- **读不到「哪个 pane 的正文」**：`editor` / `do: open` 的 marker 等待读的都是 AX 快照里
  **第一个** `AXTextArea`（DOM 顺序 = 左 pane 在前）。因此右 pane 的正文**没有可断言的通道**
  ——「跨 pane 移动后右 pane 里是 tabs-a 的正文」这条只能靠 modeline（前台路径）+ 标签计数
  间接证，不能直接断正文串。这也是上面那步 `do: open` 故意不给 `marker` 的原因：给了会盯错
  textarea 而恒真超时（假红，且归因指向错的东西）。
- **键注入落在左 pane**：套件的 `do: type` / `keys` 回读目标同样是第一个 `AXTextArea`，且
  `type` 会先真实点击聚焦——点击落在左 pane。因此本场景**不断言**「在右 pane 里键入」这类
  行为（判不动），跨 pane 的编辑路由与 ⌘S 落点由单测 / 视觉层承担。
- **跨 pane 移动的撤销史 / 滚动保留、⌘S 只存活跃 pane 前台**：本套件的真机通道读不到
  `scrollTop` / 光标 / 选区（见场景 14 的同款边界），这两条在 chromium 视觉层与单测里判
  （`src/pane-layout.ts` / `src/main.ts` 的相关单测；视觉层见 change 的 7.2 批次）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance`，隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 不写任何文件（只切分栏 / 切活跃 / 收起），不唤起系统应用。
- 会 `AXRaise` 抢前台焦点（键盘步骤需要），跑完由套件交还。
- 分栏布局会随会话文件落盘（`pane_split_ratio`），但本场景全程只读/切 pane、不拖分隔条，
  松手写盘不触发；切 vault 前 flush 写的是合成 vault 的会话文件，不碰用户真实 vault。
