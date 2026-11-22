---
# spec harness「模型选择」：发送消息时没有任何可用 provider ⇒ 返回 `harness_provider_missing`
# 人话错误并**保留输入区内容**；「发送与写失败保留语义」：被拒时恢复发送前 text / caret / cards
# 且草稿不变。M-nov22 的发送拒绝回滚把这条合同扩到「撤销本次乐观上屏的幽灵消息 + 会话名回退」。
#
# 构造：**不配置任何 provider**（不写 config.harness 节 ⇒ `[harness].provider` 为空、providers
# 为空）⇒ `harness_send` 的 preflight（`llm::send_preflight`）在**建会话之前**拒绝，无网络请求。
# 与 138（kimi + vision:false 的图片能力闸）互补：那条走"已配置但不支持图片"，本条走"根本没有
# 可用的 provider"。
id: "708-harness-send-reject-rollback"
item: 708
tier: full
title: 发送被 provider_missing 拒：幽灵消息撤销、文本与 caret 还原、草稿原样（无 provider 环境）
open: harness-note.md
marker: "HNL-ALPHA"
seed:
  registry:
    - { id: acc-reject, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-reject:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等 A 装载 + harness pane 按存储装配（无 provider：模型 chip 空态）
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 点 composer 聚焦并键入内容
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 键入标记串
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|rejectkeep" }
    text: "rejectkeep"
    expect:
      - label: 标记落在 composer（注入落地的正观测）
        ax: { has: "rejectkeep" }

  # 中部 caret：两次 ← 后光标在第 8 位（"rejectkeep" 的 'e' 与 'e' 之间）。发送被拒后这个位置
  # 必须原样回来——由后面的键入落位当判据（AX 读不到 caret 坐标）。
  - name: ← 一次（caret 左移到第 9 位）
    do: key
    key: "left"
    gapMs: 150
  - name: ← 再一次（caret 到第 8 位）
    do: key
    key: "left"
    gapMs: 150

  - name: 等防抖落盘（1s 窗口 + 2.5s 余量）
    do: sleep
    ms: 2500
    expect:
      - label: 前置：被拒前的草稿文件在位且含标记（否则「被拒后不变」是空过）
        file: { path: "env:harness/drafts/acc-reject.json", has: "rejectkeep" }
      - shot: 02-发送前-草稿在位

  - name: 记下草稿基线（被拒后须逐字节不变）
    do: record
    as: draft-reject
    file: "env:harness/drafts/acc-reject.json"

  - name: 发送（无 provider ⇒ preflight 拒绝）
    do: key
    key: enter

  - name: 等拒绝上屏（D695 人话：还没有可用的 provider）
    do: waitFor
    waitFor:
      has: ["还没有可用的 provider"]
    timeoutMs: 15000
    expect:
      - label: 拒绝人话错误行（D695，取文案表而非后端兜底 message）
        ax: { has: "/还没有可用的 provider/" }
      - label: 输入区文本原样保留
        ax: { has: "rejectkeep" }
      - label: 会话不推进：会话名钮仍是「新会话」（首条消息的乐观命名被撤回）
        ax: { has: "/AXPopUpButton \\(新会话\\)/" }
      - label: 草稿逐字节未变（MUST NOT 先清空再回滚）
        file: { path: "env:harness/drafts/acc-reject.json", unchangedSince: draft-reject, mtimeUnchangedSince: draft-reject }
      - shot: 03-被拒后-输入区与草稿保留

  - name: 等一拍（回滚触发的自动保存若会写什么，这一拍足够它落地）
    do: sleep
    ms: 1500
    expect:
      - label: 回滚没有排期第二次写盘（内容与发送前逐字段相同 ⇒ 无变更不写）
        file: { path: "env:harness/drafts/acc-reject.json", unchangedSince: draft-reject, mtimeUnchangedSince: draft-reject }
      - label: 回滚没把草稿写成空壳
        file: { path: "env:harness/drafts/acc-reject.json", has: "rejectkeep" }
      - shot: 04-拍后-草稿仍在

  # caret 还原的功能判据：键入 x 必须落在发送前的第 8 位。落位由 composer 的 CM 状态决定
  # （回滚经 resetComposer(text, caret, cards) 还原），用户可见的结果是 "rejectkexep"。
  # 字符注入走 keys（逐键 press_key）——与 117 / 255 同一条通道，单字符可用。
  - name: 在还原后的 caret 键入 x
    do: keys
    keys: ["x"]
    gapMs: 150
    expect:
      - label: 字符落在中部第 8 位（caret 已还原）
        ax: { has: "rejectkexep" }
      - label: 区分度反向对照：MUST NOT 追加到末尾（那会得到 rejectkeepx）
        ax: { not: "rejectkeepx" }
      - shot: 05-caret-落点
---

# 708-harness-send-reject-rollback —— 发送被 provider_missing 拒时的回滚

## 本场景在验什么

spec 的两条既有合同，在**没有任何可用 provider** 这一拒绝形态下同时成立：

- 「模型选择」：发送消息 SHALL 返回 `harness_provider_missing` 人话错误**并保留输入区内容**；
- 「发送与写失败保留语义」：被拒时恢复发送前的 text / caret / cards，且草稿不变。

M-nov22 的发送拒绝回滚把合同落到统一路径：所有 `harnessSend` 的同步拒绝都撤销**本次**乐观
上屏的那条 user 消息（幽灵消息）、把会话名退回发送前的显示、逐字段还原输入区；差别只在相位
收口与出口形态（图片能力闸 = 卡片错误态 + toast；忙 = 错误行 + 只读快照；其余 = 错误行）。

## 判据为什么这样写

- **D695 人话是拒绝出口的主判据**：「还没有可用的 provider」只可能来自文案表的 D695（code →
  键映射），不是后端兜底 message，也不是别的拒绝形态能说出的句子。
- **会话名钮「新会话」是「消息未被受理」的正观测**：首条消息被受理会按它命名——名字没变 =
  会话没推进。没有用户气泡这类负向断言在 AX 里没有区分度（composer 文本同样可见）。
- **草稿 `unchangedSince` + `mtimeUnchangedSince` + 事后 `has` 三判**：逐字节比对排除「被改写成
  别的」，mtime 成对断言排除「内容相同但重写了一次」的空跑路径，`has` 排除「被写成空壳」。
  回滚后内容与发送前逐字段相同 ⇒ store 的「无变更不写」不排期第二次写盘。
- **caret 用键入落位当判据**：AX 读不到 caret 坐标，而「下一个字符落在哪里」正是用户能感知的
  那个东西。两次 ← 把 caret 放到第 8 位，被拒后键入 x 必须得 `rejectkexep`；反向对照
  （`rejectkeepx` 不在场）排除「caret 停在末尾」的假绿。

## 覆盖边界（如实登记）

- **真机跑绿状态：本轮未跑真机**（前台窗口由 tower 统一安排）。本场景随修复同 PR 交付；真机
  PASS 证据以 `.local/acceptance/` 下该场景的 steps.md 为准，未跑前不得宣称已 PASS。
- **富内容逐字段还原（多行文本 / 引用卡 / 图片卡 / 中部 caret）归视觉层**
  `tests/visual/scenes/harness-send-reject-nov22.spec.ts`：它读 composer 的 CM 状态逐字段比对。
  本层只构造文本 + caret 的真实键盘路径。
- **拒绝回包迟到（视图换代 / 等待期间的新输入合并）归视觉层同一 spec**：真机的同步拒绝是
  Promise 立即 reject，构造不出「迟到回包」的时序窗口——那两条是测试构造的边（视觉层用挂起
  桩），本层不重复；本层也不得据此宣称覆盖了它们。
- **图片能力闸的拒绝面由 138 覆盖**（同一回滚路径的另一出口：卡片错误态 + toast、无错误行）。
- **拒绝后改用可用 provider 重发成功不在本场景**：配置是 launch 期的；成功发送清草稿由 137
  覆盖。
- **`harness_busy` / `harness_thread_failed` 等其余同步拒绝**的同一回滚面由视觉层用例覆盖
  （m756 的 busy 用例 + 新 spec 的 thread_failed / 缺 Key / 缺模型用例）。

## 环境与副作用

- 合成 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 无 provider 配置：发送在 preflight 处即被拒（不建会话、不产生网络请求），草稿落盘仍发生
  （草稿持久化与 provider 无关）。
- 端口走 `LUMIR_ACCEPTANCE_PORT`（缺省 1430），不碰 1420。
