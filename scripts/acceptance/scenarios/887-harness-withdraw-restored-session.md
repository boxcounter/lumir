---
# change withdraw-restored-user-message-nov27（Alex 2026-11-27 节点 1 批准：「好，采纳这个改进。
# 请你安排。」）：恢复出来的旧会话也能撤回最近一条真实用户消息，且撤回后切走再恢复不复活。
#
# 判据分三层，每层都有区分度：
# 1. 入口层：恢复完成后**立刻**能在最后一条用户消息上点到「撤回」——恢复流程不重取
#    `harness_state`，钮的可见性只能来自恢复回执的 `withdrawable`（后端按留存里的
#    `lumir_user_origin=interactive` 标记重建目标）。回执不带这一项 / 后端不重建目标时，
#    本步点不到钮，场景红。
# 2. 撤回层：与 882 同口径——transcript 移除（`node` 判在场性，忽略编辑器内部文本）、原文回到
#    composer（`AXTextArea` 的值）、盘上只剩 B 一份 JSONL、B 里没有被撤回文本。
# 3. 复活层：切走再从清单恢复 B，被撤回的那句既不在面板上、也不在盘上——恢复件撤回删的是
#    **恢复来源**（恢复是惰性发布，当前会话没有自己的文件），来源不删就会在这一步复活。
#
# 撤回钮 hover 才显形（读屏名 D1052「撤回」）；本场景走套件的 AXPress 点击通道，hover 的视觉
# 形态不在判据内（属手感，归 Alex；按钮可发现性不在本 change 的 scope）。
id: "887-harness-withdraw-restored-session"
item: 887
tier: full
title: 恢复旧会话后撤回最近一条用户消息：删的是恢复来源、再恢复不复活
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  registry:
    - { id: acc-withdraw, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-withdraw:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.5
      harnessPane: true
steps:
  - name: 等 harness pane 按存储装配
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 点 composer 建立输入焦点
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 输入第一句（撤回后应保留的前缀）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|q887-RESTORE-A" }
    text: "q887-RESTORE-A"

  - name: 发送第一句
    do: key
    key: enter

  - name: 等第一轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000

  - name: 等回合收口
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 点 composer 重新建立焦点（发送后焦点让给 transcript）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 输入第二句（本轮要撤回的那一条）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|q887-WITHDRAWN" }
    text: "q887-WITHDRAWN"

  - name: 发送第二句
    do: key
    key: enter

  - name: 等第二轮请求落盘（同一会话文件的 messages 带上第二句——回答文案两轮相同，
      不能用它当「第二轮跑过」的判据）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/acc-withdraw/*.jsonl"
      has: "q887-WITHDRAWN"
    timeoutMs: 30000

  - name: 等回合收口
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000
    expect:
      - label: 撤回前：transcript 里有第二句
        node: { role: AXStaticText, name: "q887-WITHDRAWN", present: true }
      - shot: 02-撤回前

  # 恢复的入口必须是「新会话把当前会话切成历史，再从清单选中它」——同源直切（switched=false）
  # 不会走恢复路径，恢复目标也就无从重建。
  - name: 点「＋新会话」把当前会话切成历史会话
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成（transcript 回到空态）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（会话名 = 首条用户消息）
    do: waitFor
    waitFor:
      has: ["q887-RESTORE-A"]
    timeoutMs: 15000

  - name: 点历史会话行——走恢复路径（读末条 llm_request，恢复期从来源标记重建撤回目标）
    do: clickInNode
    target: { name: "q887-RESTORE-A" }

  - name: 等恢复完成（会话名落回源会话首条用户消息）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(q887-RESTORE-A/"]
    timeoutMs: 15000

  - name: 恢复后的 transcript 重建完成
    do: settle
    expect:
      - label: 恢复出的 transcript 有第一句（保留的前缀）
        node: { role: AXStaticText, name: "q887-RESTORE-A", present: true }
      - label: 恢复出的 transcript 有第二句（本次要撤回的那条）
        node: { role: AXStaticText, name: "q887-WITHDRAWN", present: true }
      - shot: 03-恢复后

  - name: 点最后一条用户消息上的「撤回」（回执的 withdrawable 驱动钮的可见性——点不到即红）
    do: click
    target: { role: AXButton, name: "^撤回$" }

  - name: 等新会话文件发布（B 的 opened_from=withdraw）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/acc-withdraw/*.jsonl"
      has: '"opened_from":"withdraw"'
    timeoutMs: 20000
    expect:
      - label: transcript 不再显示被撤回的消息
        node: { role: AXStaticText, name: "q887-WITHDRAWN", present: false }
      - label: 前缀那条仍在 transcript 里
        node: { role: AXStaticText, name: "q887-RESTORE-A", present: true }
      - label: 原文回到 composer（AXTextArea 的值）
        node: { role: AXTextArea, name: "q887-WITHDRAWN", present: true }
      - label: 会话目录只剩一份 JSONL（恢复来源已被删除，只留 B）
        glob: { dir: "env:harness/sessions/acc-withdraw", pattern: "/[^/]+\\.jsonl$", exact: 1 }
      - label: B 里没有撤回前的文本（seed 只携带撤回点之前的前缀）
        file: { path: "env:harness/sessions/acc-withdraw/*.jsonl", not: "q887-WITHDRAWN" }
      - shot: 04-撤回后

  # 复活层：切走再**从清单恢复 B**。B 的 seed 只带前缀，被撤回的那句在任何留存量里都不存在。
  - name: 点「＋新会话」回到空态（恢复 B 前先离开它）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层（此时清单里只有 B，名字取 seed 的首条用户消息）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等 B 的行出现
    do: waitFor
    waitFor:
      has: ["q887-RESTORE-A"]
    timeoutMs: 15000

  - name: 点 B 的行——从清单恢复 B
    do: clickInNode
    target: { name: "q887-RESTORE-A" }

  - name: 等恢复完成
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(q887-RESTORE-A/"]
    timeoutMs: 15000

  - name: 恢复 B 之后的判据：前缀在、被撤回的那句不在面板上也不在盘上
    do: settle
    expect:
      - label: 恢复 B 后前缀那条仍在（transcript 非空的正观测）
        node: { role: AXStaticText, name: "q887-RESTORE-A", present: true }
      - label: 被撤回的消息没有随恢复复活
        node: { role: AXStaticText, name: "q887-WITHDRAWN", present: false }
      - label: 盘上也没有被撤回的文本
        file: { path: "env:harness/sessions/acc-withdraw/*.jsonl", not: "q887-WITHDRAWN" }
      - label: 恢复查看不创建新文件（惰性发布）
        glob: { dir: "env:harness/sessions/acc-withdraw", pattern: "/[^/]+\\.jsonl$", exact: 1 }
      - shot: 05-复活检查
---

# 887-harness-withdraw-restored-session —— 恢复件撤回

## 本场景在验什么

`add-harness-message-withdraw-nov26` 只对「本进程发起的交互轮 / 重试轮」开放撤回：撤回目标来自
两个内存态字段（`last_turn_origin` / `withdraw_target`），恢复出来的会话两者皆空，`withdrawable`
恒 false。`withdraw-restored-user-message-nov27` 让恢复出来的普通交互会话也能撤回最近一条真实用户
消息：交互发送时在用户项上持久化 `lumir_user_origin=interactive`，恢复期据此重建目标；恢复件
撤回删的是**恢复来源**（恢复尚未发布任何轮次，当前会话没有自己的文件），祖先链里仍有副本时拒绝。

## 断言口径

- **入口层用「点得到撤回钮」当判据**：恢复流程不重取 `harness_state`，钮的可见性只可能来自恢复
  回执的 `withdrawable`。回执缺这一项、或后端没重建目标时，本场景恢复后点击撤回的那一步的 `click` 直接失败——
  这就是它对本 change 的区分度（旧实现上必红）。
- **第二轮的完成判据不取回答文案**：mock fixture 只回一句固定文本，两轮相同，`has` 断言在第二轮
  之前就成立。改用 `waitForFile` 看同一会话文件的 `llm_request.messages` 是否带上第二句——请求
  落盘即证明这一轮真实开跑。
- **层 2 / 层 3 复用 882 的口径**：`node` 判在场性（`AXStaticText`，忽略编辑器内部文本——否则
  原文一回到 composer，负向断言恒红）；composer 用 `AXTextArea` 的值判；盘上用 `glob exact:1`
  判「只剩 B」，用 `file ... not` 判「B 里没有撤回文本」。
- **复活层的判别力**：恢复件撤回若只删当前会话的空身份（或什么都不删），来源留存仍带着被撤回的
  那句，最后一步的 `node present:false` 与 `file not` 都会红。

## 覆盖边界（如实登记）

- **不判按钮可发现性**：hover 之前的透明形态、按钮位置属手感，归 Alex；本 change 不扩这个 scope。
- **不判祖先链副本拒绝**（`harness_withdraw_copy_exists`）：造它需要「来源本身是恢复件且更早留存
  仍含该消息」的链式历史，真机路径要连续两次恢复 + 一条非交互轮发布，场景成本高且形态罕见；
  该判据由 `src-tauri/src/harness/withdraw_tests.rs` 的
  `withdraw_refuses_when_an_ancestor_retention_still_holds_the_message` 覆盖。
- **不判工具二次确认**：撤回当轮没有工具调用；二次确认与副作用清单仍由 882 覆盖。
- **不判旧留存（无来源标记）的拒绝**：需要一份本 change 之前写下的会话，真机流水线造不出来；
  该判据在 `restored_legacy_session_without_origin_marker_is_not_withdrawable`。

## 环境与副作用

- 合成验收 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 场景内删掉的是验收 vault 配置目录下的会话留存（不是 vault 内容）；套件每场景重置。
