---
id: "80-pane-session-restore"
item: 80
title: 分栏会话恢复——双 pane 各一标签，启动恢复后归位原 pane（不挤到右栏）
fixtures: [tabs-a.md, tabs-b.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [tabs-a.md], active: tabs-a.md }
        - { tabs: [tabs-b.md], active: tabs-b.md }
      ratio: 0.5
steps:
  - name: 等启动恢复（vault + 分栏 + 逐 pane 装载）落定
    do: waitFor
    waitFor:
      has: ["分隔条", "标签场景 A"]
    timeoutMs: 30000
    expect:
      - shot: 分栏会话恢复后的终态
      - label: 分栏恢复出来（分隔条在位，D368 读屏名）
        ax: { has: "分隔条" }
      - label: 会话里的两个标签都恢复了（每个标签恰一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      # AX 快照里第一个 AXTextArea = 左 pane（DOM 顺序左先）。缺陷现场（M320 finding）里
      # 左 pane 标签被「打开即移动」抢到右 pane、左 pane 变空——这一条因此必然 FAIL。
      - label: 左 pane（pane0）的正文是会话里 pane0 的激活项 tabs-a（归位原 pane）
        editor: { has: "标签场景 A" }
      - label: 左 pane 的前台不是 pane1 的条目（归位错误的反证）
        editor: { not: "标签场景 B" }

  - name: 等会话回写落盘（防抖 1s），核对 pane 归属未被破坏
    do: sleep
    ms: 2600
    expect:
      - label: 两个条目都还在会话里
        file: { path: "env:vault-sessions/acc-a.json", has: "tabs-a.md" }
      - label: 第二个条目也在
        file: { path: "env:vault-sessions/acc-a.json", has: "tabs-b.md" }
      # 缺陷现场：回写的会话变成 panes:[[],[tabs-b,tabs-a]]——左 pane 的 tabs 变空数组。
      # 这条负向断言盯的正是它（serde_json pretty 里空数组渲染成 `"tabs": []`）。
      - label: 回写的会话里没有空 pane（每 pane 都保住了自己的标签）
        file: { path: "env:vault-sessions/acc-a.json", not: '/"tabs":\s*\[\s*\]/' }
      - label: 回写的会话仍是 v2 分栏形状（不是回退成单 pane）
        file: { path: "env:vault-sessions/acc-a.json", has: '"version": 2' }
---

说明：本条验的是 **M318 已合并的核心承诺——按 pane 恢复**：会话里 pane0/pane1 各一标签时，
启动恢复后标签必须**归位原 pane**，而不是全挤到右 pane、左 pane 变空。

背景（缺陷）：M320 内存实测偶然复现并用 chromium 探针定向确认——`src/main.ts` 的
`openFile` 有一条 M317 4.2 的「打开即移动」（命中他 pane 已开的同文件时把它移到活跃 pane）。
恢复编排（`src/vault-switcher.ts` 的 restore）是**逐 pane** 装载激活项，而恢复期活跃 pane 是
`applyPaneCount` 后建的右 pane——于是 pane0 的激活项被这条移动分支抢到 pane1，真机会话回写
变成 `panes:[[],[tabs-b,tabs-a]]`。修复（M321）给恢复装载一条显式落点参数（条目所属 pane），
让它不走「打开即移动」。

**为什么既有场景 16/17/18 没抓住它**：这三条都只预置**单 pane** 会话（16 根本没有会话、17/18
的 `seed.sessions` 走顶层 `tabs`/`active` 的 v1 形状），恢复路径里只有一个 pane，M317 4.2 的
移动分支（`ownerId !== activePaneId`）永远不成立。场景 79 覆盖了「活跃 pane 为右、从树里打开
已在左 pane 的文件」这条**用户**路径（那正是 4.2 的正当行为）与分栏的实时交互，但**没有**任何
一条预置**分栏会话**并断言恢复后的 pane 归属——恢复 + 分栏这两个面的交叉就是盲区。本条补上它。

**断言口径与盲区**：
- 「左 pane 归位」用 AX 里**第一个** `AXTextArea` 的正文（`editor` 形态）判定——DOM 顺序左 pane
  在前（与场景 79 同款边界）。缺陷现场左 pane 为空，`editor: { has: "标签场景 A" }` 必 FAIL。
- **右 pane 的正文读不到**（本套件只读第一个 AXTextArea，见场景 79 的「已知边界」），因此
  「tabs-b 确实在右 pane」由**会话回写文件**作证：恢复完成后前端防抖回写本 vault 的会话，
  缺陷现场会写成 `"tabs": []`（空左 pane）+ 右 pane 两个标签；修复后每 pane 各一标签。
  负向断言 `/\"tabs\":\s*\[\s*\]/` 与两条 `has` 合起来才有区分度。
- 会话文件断言走 `env:` 前缀（隔离配置目录），不碰用户 `~/.config/lumir`。

**环境与副作用**：合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；会 `AXRaise`
抢前台焦点（键盘/就绪门需要），跑完由套件交还；1420 全程不碰，套件走自带 1430。**不写 vault**，
只读 fixtures 与会话文件。
