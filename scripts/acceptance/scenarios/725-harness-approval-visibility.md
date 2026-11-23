---
# change fix-harness-approval-visibility-nov23 的真机判据：引用卡发送 → **先上滚** → 待批到达
# → 标题栏信号 / 未读 → 回底 → 采纳 → 第二条待批 → 停止撤回；外加「待批已存在后上滚、无新内容
# → 不点亮未读」的对照。
#
# 为什么必须在真机：本 change 的场景是「底部一直显示处理中，批准卡在屏外」——判据落在
# WKWebView 的真实滚动 / 摘录手势 / 标题栏 AX 通道上，chromium 只守几何与结构（m347 / m756 /
# m638 / m384）。滚动本身不暴露 scrollTop（README「已知边界」），因此用浮钮在场性 / 未读可访问名
# 与截图证据间接判；标题栏信号用 AX 文本判（段状态词 / toggle help）。
#
# mock 脚本：① 长回答（可滚）；② 第一处 patch（`delay_ms: 6000` 给「先上滚、后待批」的窗口）；
# ③ 采纳后第二处 patch（第二条待批 → 停止撤回）。全部合成文本。
id: "725-harness-approval-visibility"
item: 725
tier: full
title: 待批可见性：脱离态下批准卡到达仍有标题栏信号与未读；回底决策后清算；停止撤回无幻影
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-approval-visibility.json"
    # vault_patch 只在 read_only 档逐个问（默认 vault_write 自动放行、无闸——同 72 的归因）。
    permission_mode: read_only
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键/错键会显著加剧——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 第一轮提问，建立一条可摘录的长回答
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|avis" }
    text: "avis"
  - name: 发送
    do: key
    key: enter
  - name: 等长回答到达（transcript 可滚是后续脱离态判据的前提）
    do: waitFor
    waitFor:
      has: ["AVIS-END 回答结束。"]
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
    expect:
      - label: 回答末段已上屏（内容足够高）
        ax: { has: "AVIS-END 回答结束。" }
      - shot: 01-长回答

  - name: 拖选回答正文 → 浮动「摘录到对话」钮（坐标随 fixture 布局走，改 fixture 须重取）
    do: drag
    target: { x: 900, y: 130 }
    dx: 120
    dy: 0
    selection: "/AXButton \\(摘录到对话\\)/"
    expect:
      - label: 浮动摘录钮在场（选区建立的正观测）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }

  - name: 点浮动钮把摘录卡放进 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片出处行「对话 · Agent」在场
        ax: { has: "对话 · Agent" }
      - shot: 02-引用卡入composer

  - name: 写问题（卡片下一行）
    do: typeInNode
    target: { role: AXTextArea, name: "Agent|avis-quote" }
    text: "avis-quote"
  - name: 发送（携带引用卡）
    do: key
    key: enter

  - name: "先上滚——在这一轮待批到达之前进入脱离态（delay_ms 给窗口）"
    do: scroll
    target: { x: 900, y: 350 }
    dy: 20
    wheel: true
    settleMs: 900
    expect:
      - label: 上滚真的产生了脱离态（回底钮在场；通道自证）
        node: { role: AXButton, name: "回到底部", present: true }
      - shot: 03-先上滚

  - name: 等第一张批准卡到达（此时视口在屏外上方）
    do: waitFor
    waitFor:
      has: ["要修改这个文件吗？"]
    timeoutMs: 30000
    expect:
      - label: 阶段行独立成档「等待批准…」（D976）
        ax: { has: "等待批准…" }
      - label: 标题栏 harness 段状态词读「等待批准」（面板打开时的滚动区外信号）
        ax: { has: "等待批准" }
      - label: 批准卡在屏外之外仍到达（AX 树含离屏内容；卡本身不拽视口）
        ax: { has: "要修改这个文件吗？" }
      - label: 批准卡是新内容 → 浮钮未读态（D556 可访问名）
        node: { role: AXButton, name: "有新内容，回到底部", present: true }
      - shot: 04-屏外待批与标题栏信号

  - name: 收起面板：toggle 状态承担同一状态（AX 读到的 help）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板已收起
        ax: { not: "分隔条" }
      - label: 收起态 toggle 悬停提示读「对话面板 · 等待批准」
        ax: { has: "对话面板 · 等待批准" }
      - shot: 05-收起态仍有审批信号

  - name: 重新打开面板（重开不拉快照，保留的是本地状态）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板回到场上
        ax: { has: "分隔条" }
      - label: 待批状态仍在（重开保留本地状态）
        ax: { has: "等待批准…" }
      - shot: 06-重开仍待批

  - name: 点浮钮回底：批准卡进入视口，状态仍在（回底不是决策）
    do: click
    target: { role: AXButton, name: "有新内容，回到底部" }
    expect:
      - label: 回底后浮钮退场
        node: { role: AXButton, name: "回到底部", present: false }
      - label: 批准卡可见（问句 + 闸语义副句）
        ax: { has: "要修改这个文件吗？" }
      - label: 闸语义副句在场（采纳前不落盘）
        ax: { has: "批准后才会落盘" }
      - label: 阶段行仍读「等待批准…」（回底不是决策）
        ax: { has: "等待批准…" }
      - shot: 07-回底后仍待批

  - name: 采纳第一处
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等第二张批准卡（第一条决策后同一轮继续，第二条写工具重新问）
    do: waitFor
    waitFor:
      has: ["AVIS-PENDING-2 再准备改第二处。"]
    timeoutMs: 30000
    expect:
      - label: 第二张卡到达（新一轮待批仍是同一条目）
        ax: { has: "要修改这个文件吗？" }
      - label: 阶段行仍读「等待批准…」
        ax: { has: "等待批准…" }
      - shot: 08-第二条待批

  - name: 对照：待批已存在后上滚、期间无新内容 → 不点亮未读、不强制回底
    do: scroll
    target: { x: 900, y: 350 }
    dy: 20
    wheel: true
    settleMs: 900
    expect:
      - label: 上滚后回底钮在场（脱离态成立）
        node: { role: AXButton, name: "回到底部", present: true }
      - label: 未读 MUST NOT 因待批状态本身点亮（可访问名仍是无新内容那一条）
        node: { role: AXButton, name: "有新内容，回到底部", present: false }
      - label: 状态仍是待批（没有因滚动被清）
        ax: { has: "等待批准…" }
      - shot: 09-待批后上滚不点亮未读

  - name: 停止这一轮（running 相位下同一颗钮是停止态）
    do: click
    target: { role: AXButton, name: "^停止$" }

  - name: 等停止收口：卡撤下、工具行标已停止、四处状态零残留
    do: waitFor
    waitFor:
      has: ["已停止"]
      not: ["等待批准…", "等待批准"]
    timeoutMs: 30000
    expect:
      - label: 待决卡撤下（问句不再在场）
        ax: { not: "要修改这个文件吗？" }
      - label: 工具行标注「已停止」（D383）
        ax: { has: "已停止" }
      - label: 阶段行 / 段状态词 / toggle 状态无「等待批准」幻影
        ax: { not: "等待批准…" }
      - label: 发送钮回到「发送」（相位收口）
        ax: { has: "/AXButton \\(发送\\)/" }
      - shot: 10-停止撤回无幻影
---

# 725-harness-approval-visibility —— 待批在滚动区外也看得见

## 本场景在验什么

Alex 的现场：引用一段回答发出去，随后模型调用了需要批准的写工具，底部一直显示「处理中」，
批准卡在屏外，两分钟后手动上滚才发现。根因两条叠加：①「等待批准」没有独立状态；②脱离态下
批准卡随内容滚动、屏外无可发现信号。本场景按用户实际路径走一遍：

1. 引用卡发送 → 长回答撑出可滚内容；
2. **先上滚**（此时没有待批）→ 待批在屏外到达：阶段行读「等待批准…」、标题栏 harness 段读
   「等待批准」、浮钮点亮未读；
3. 收起面板：toggle 悬停提示读「对话面板 · 等待批准」（唯一的在場承载）；
4. 回底：批准卡可见，状态仍在（回底不是决策）；
5. 采纳 → 第二条待批 → 对照（待批已存在后上滚，无新内容 → 未读不点亮）；
6. 停止 → 卡撤下、行标「已停止」、四处状态零残留。

## 判据为什么这样写

- **滚动位置不可直接读**：WKWebView 不暴露 `scrollTop`（README「已知边界」），因此「视口没被
  拽走」由浮钮在场性 / 未读可访问名与截图证据间接判；`do: scroll` 的通道自证见场景 224 的注释
  （`dy` 正数 = 上滚，KimiCU 无位移时退到 CGEvent 滚轮）。
- **标题栏信号分两种承载**：面板打开时 toggle 按退让条款隐藏，AX 读 `等待批准` 的可见文本来自
  标题栏段状态词；面板收起时读 toggle 的 `help`（`title` → `对话面板 · 等待批准`）。两处同源、
  互斥可见，MUST NOT 双播报。
- **待批不是新内容**：状态出现 / 退场只改文案与显隐；未读只由批准卡本身（内容增长）点亮。
  对照步骤专门判「待批已存在后上滚、无新内容」不点亮未读。
- **决策 / 停止的清算**：四处（阶段行 / 段状态词 / toggle 状态文本 / 悬停提示）都不得残留
  「等待批准」；停止后工具行读「已停止」（D383，不是 done / error 的「未执行」）。

## 已知边界

- 拖选坐标（`{x:900,y:130}`）随 fixture 布局走（仓库信息卫生：全部合成文本）；改 fixture 或
  窗口尺寸须按场景 121 的方法重取。
- 本场景不建视觉基线；截图证据落 `.local/acceptance/`（runner 的证据布局）。
