---
# mission harness-navigation-nov21 的真机判据（change fix-harness-navigation-nov21）：
# 点击 cron **结果通知**时 harness pane 应展开并恢复该次运行的会话，但正文（文档编辑器）的
# 焦点与阅读位置 MUST NOT 被抢走——后续键盘输入必须仍落在正文里，而不是 harness composer。
#
# 为什么焦点判据用「键入落点」：AX 里编辑器与 composer 都是 AXTextArea，只看 role 分不出
# 焦点归属（scripts/acceptance/README.md 的 `focusWindow click` 条同一归因）；把「按键落在
# 正文」写成机器判据，才真正区分「焦点在正文」与「焦点被 composer 抢走」。
# 阅读位置（滚动）AX 读不到，由截图人工判读（与 161 / 221 的同一已知边界）。
id: "270-cron-open-session-keeps-doc-focus"
item: 706
tier: bundle
title: 点击 cron 结果通知：展开 pane 并恢复会话，正文焦点与输入落点不被抢
# dev flavour 的通知点击响应路由到 Terminal（与 170 / 171 / 252 同一口径）：点击链路只能在
# 打包实例上判。
requires: bundle
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-navigation.json"
  cron:
    tasks:
      - id: "acc-nav-focus"
        vault: "$vault"
        # 通知必须落在套件开始轮询之后（横幅只停留约 5s；`$pastMinute` 会与就绪门赛跑）。
        at: "$nextMinute"
        prompt: "CRON-NAV-PROMPT 焦点不被抢的会话内容。"
        delivery: "run-then-notify"
        session: "new"
steps:
  - name: 拿前台（键盘 / 真实单击的前置纪律）
    do: focusWindow
    retries: 4

  - name: 真实单击正文，建立「编辑器的焦点 + 光标」这个前置状态
    do: clickEditor
    real: true
    retries: 4
    expect:
      - label: 正文已装载（编辑器可读的正观测）
        editor: { has: "HNL-ALPHA" }

  - name: 记正文基线（点击通知前后的逐字节比较）
    do: recordEditor
    as: beforeCronOpen

  - name: 等结果通知横幅出现（后台运行完成后的「已完成」通知）
    do: waitForNotification
    title: "acc-nav-focus"
    body: "已完成"
    # `$nextMinute` 最坏 ≈120s，再加 30s tick 余量。
    timeoutMs: 180000
    expect:
      - label: 后台运行已发起（无用户点击）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_started }
      - label: 运行终态 ok=true
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_run_finished, ok: "true" }

  - name: 点击结果通知横幅（系统通知中心 AXPress = 真实点击）
    do: clickNotification
    title: "acc-nav-focus"
    body: "已完成"

  - name: 等会话恢复上屏（恢复内容出现即 pane 已展开）
    do: waitFor
    waitFor:
      has: ["CRON-NAV-RESTORED"]
    timeoutMs: 30000
    expect:
      - label: 点击链路被处理（cron_click ok=true, action=open-session, source=in-process）
        file:
          path: "env:logs/*.jsonl"
          jsonl: { event: cron_click, task: acc-nav-focus, ok: "true", action: open-session, source: in-process }
      - label: 面板以旁侧 pane 在场（发送钮是可读取的正观测）
        node: { role: AXButton, name: "^发送$", present: true }
      - label: 恢复的是该次运行的会话内容
        ax: { has: "CRON-NAV-RESTORED" }
      - label: 点击通知不改写正文（焦点没有被拿去输入）
        editor: { unchangedSince: beforeCronOpen }
      - shot: 01-结果通知点击后的面板与正文

  - name: 键盘输入一个判别标记（落在当前焦点元素）
    do: keys
    keys: ["u", "v", "w"]

  - name: 键入落点判据
    do: settle
    expect:
      # 两条合起来才是判别性的：changedSince 证明正文被改过，has 证明改的是我们注入的那串。
      # 若 composer 抢走了焦点，正文逐字节不变 ⇒ changedSince 判红（旧代码的现场）。
      - label: 键入落在正文（composer 没有抢走焦点）
        editor: { changedSince: beforeCronOpen }
      - label: 正文里出现刚键入的标记
        editor: { has: "uvw" }
      - shot: 02-键入后的正文（阅读位置由截图判读）
---

# 270-cron-open-session-keeps-doc-focus —— 结果通知点击不抢正文焦点

## 本场景在验什么

mission harness-navigation-nov21 的第二个缺陷：`handleCronOpenSession` 调用无参
`openHarnessPane()`，后者无条件 `harnessPanel.focusComposer()`。pane 关闭时点结果通知 ⇒ pane
展开、会话恢复，但**正文编辑器的焦点被 composer 抢走**，用户接下来的键入会落进对话输入区。

修复后本场景钉住：

1. 点击结果通知 → `cron_click(ok=true, action=open-session, source=in-process)`（既有链路不变）；
2. harness pane 展开、恢复的会话内容上屏（`CRON-NAV-RESTORED`）；
3. 正文逐字节不变（点击不编辑）；
4. **后续键入落在正文**（`editor.changedSince` + `editor.has "uvw"`）——焦点没有被 composer 抢走；
5. 截图留作阅读位置（滚动）的人工判读。

## 判据为什么这样写

- **为什么不用 `ax: { focused: "AXTextArea" }`**：编辑器与 composer 都是 AXTextArea，只看 role
  分不出焦点归属（README 的 `focusWindow click` 条同一归因：按节点身份区分才是判据）。键入
  落点把「焦点在正文」变成机器可读的事实。
- **为什么 `changedSince` 与 `has` 成对**：只写 `has "uvw"` 时，正文里恰好出现该串就恒绿；
  只写 `changedSince` 时，任何别的原因改了正文也会绿。两条同时成立才证明「我们注入的那串落进
  了正文」。
- **`unchangedSince` 放在键入之前**：先证明点击本身不改正文，再证明键入改的是正文——顺序颠倒
  会让第一条被自己的键入打断。

## 覆盖边界（如实登记）

- **阅读位置（滚动）没有机器判据**：AXTextArea.value 是整个文档文本，AX 读不到 scrollTop
  （CL-1 / CL-2 的同一已知边界）；`02` 截图由人判读「点击通知前后视口是否跳走」。
- **pane 已打开态**：本场景只判「pane 关闭 → 点击展开」这一条真实缺陷路径；「pane 已打开时点击
  通知」的同口径判据在 `tests/visual/scenes/harness-navigation-nov21.spec.ts`（chromium 层，
  事件经真实 listen 回调注入）。
- **通知点击通道只在打包实例上可判**（dev flavour 的响应路由到 Terminal，与 170 / 171 / 252
  同一口径）；本场景因此 `tier: bundle` / `requires: bundle`。
- **样例全合成**：任务 id / prompt / 标记都是验收用合成串，不含真实 vault 内容。
