---
id: "164-harness-auto-title-keep"
item: 164
tier: full
title: 会话自动命名②：周期重估输出 keep 时标题不变（5 轮周期 + decision=keep 记录）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-title-keep.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 第 1 轮提问（首轮：初始生成标题）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepa" }
    text: "生命周期排查zqkeepa"
  - name: 发送
    do: key
    key: enter
  - name: 等第 1 轮回答 + 初始标题落到标题栏
    do: waitFor
    waitFor:
      has: ["验收回答：第1轮完成。", "/AXPopUpButton \\(生命周期排查\\) @/"]
    timeoutMs: 60000
    expect:
      - label: 初始标题生效（titles 队列第 1 条：rename；整串锚定 + 回落名反断言——回落名是「生命周期排查zqkeepa」，前缀断言对它也成立，M594 finding 实证该断言曾无区分度）
        ax:
          has: "/AXPopUpButton \\(生命周期排查\\) @/"
          not: "/AXPopUpButton \\(生命周期排查zqkeepa\\) @/"
      - label: 初始生成落 decision=initial
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"decision":"initial"' }

  - name: 第 2 轮提问（其后 5 轮与标题高度重合：漂移信号不命中，只等 5 轮周期）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第 2 轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepb" }
    text: "继续看生命周期排查第2处zqkeepb"
  - name: 发送第 2 轮
    do: key
    key: enter
  - name: 等第 2 轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：第2轮完成。"]
    timeoutMs: 60000

  - name: 第 3 轮提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第 3 轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepc" }
    text: "继续看生命周期排查第3处zqkeepc"
  - name: 发送第 3 轮
    do: key
    key: enter
  - name: 等第 3 轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：第3轮完成。"]
    timeoutMs: 60000

  - name: 第 4 轮提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第 4 轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepd" }
    text: "继续看生命周期排查第4处zqkeepd"
  - name: 发送第 4 轮
    do: key
    key: enter
  - name: 等第 4 轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：第4轮完成。"]
    timeoutMs: 60000

  - name: 第 5 轮提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第 5 轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepe" }
    text: "继续看生命周期排查第5处zqkeepe"
  - name: 发送第 5 轮
    do: key
    key: enter
  - name: 等第 5 轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：第5轮完成。"]
    timeoutMs: 60000

  - name: 第 6 轮提问（距初始评估满 5 轮：周期重估的触发点）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第 6 轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqkeepf" }
    text: "继续看生命周期排查第6处zqkeepf"
  - name: 发送第 6 轮
    do: key
    key: enter
  - name: 等第 6 轮回答
    do: waitFor
    waitFor:
      has: ["验收回答：第6轮完成。"]
    timeoutMs: 60000

  - name: 等命名调用落盘（轮后的后台线程；mock 调用瞬时，留足落盘窗口）
    do: sleep
    ms: 1500
    expect:
      - label: 标题保持不变（keep 的含义：当前标题仍能描述对话，不换名；整串锚定 + 回落名反断言，同第 1 轮）
        ax:
          has: "/AXPopUpButton \\(生命周期排查\\) @/"
          not: "/AXPopUpButton \\(生命周期排查zqkeepa\\) @/"
      - label: 周期重估落 decision=keep（审计面：模型给的是 keep，不是 rename）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"decision":"keep"' }
      - label: keep 记录的触发原因 = cadence（5 轮周期，不是漂移或初始重试）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"reason":"cadence"' }
      - label: keep 记录携带当时生效的标题（有效标题不断档）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"decision":"keep".*"title":"生命周期排查".*$/' }
      - shot: 01-keep后标题不变
---

# 164-harness-auto-title-keep —— keep 防抖（change add-session-auto-naming 5.3②）

## 本场景在验什么

标题在周期重估拿到 `keep` 时**不变**，且留存里留下一条 `decision=keep` 记录（审计面：为什么
没改名）。这是「历史列表里的名字要稳定」这条目的的直接判据——每轮换名的实现会在这里判红。

## 为什么是 6 轮

design D1/D4 的周期口径是「距上一次**完成的评估**满 5 轮」：首轮（第 1 轮）完成初始生成后，
下一次周期重估在第 6 轮（差 5）。D4 明写「周期从任何一次完成的评估（keep 或 rename）重新
计 5 轮」——所以这里不是「第 5 轮」，而是「初始评估之后再 5 轮」。

## 断言口径

- **漂移不抢跑**：第 2–6 轮的提问都含标题文本「生命周期排查」，词元重合度接近 1.0（远高于
  0.20 阈值）⇒ 连续命中不成立 ⇒ 唯一到达的触发点是第 6 轮的 cadence。这条设计让 `reason`
  断言的判据是确定的（写错触发点即红）。
- **标题保持可判**：`/AXPopUpButton \(生命周期排查\) @/` 是标题栏的会话名钮（role 分流：
  aria-haspopup → AXPopUpButton）；标题在 transcript 的用户消息里也出现，故必须锚 role，
  否则「标题是否被改名」判不出来。
- **回落名不参与命中**（M595 收紧，M594 finding）：首条用户消息是 `生命周期排查zqkeepa`，
  无标题时会话名钮的回落名就是它——所以前缀断言 `/AXPopUpButton \(生命周期排查/` 对回落名
  同样成立，`title` 事件在 IPC 边界被丢弃时该断言照样 PASS（假绿现场）。现在改为**整串锚定**
  `\) @`（AX dump 的会话名钮形态是 `AXPopUpButton (<name>) @x,y`），并补一条回落名反断言
  `not`：标题事件丢失时正断言不命中、回落名在场时反断言命中，两个方向都判红。
  区分度自证见 M595 的 `.local/acceptance/2026-10-19-m595/`（修前 164 PASS 而 163/167 红，
  修后三条同绿）。
- **keep 记录的三条**：`decision=keep`（防抖结果）、`reason=cadence`（触发点）、`title` 在场
  （keep 记录携带当时生效的标题，有效标题因此不断档）。
- **落盘等待**：命名调用是轮完成后的后台线程，AX 面没有「keep 已落盘」的信号——固定 1.5s
  等待 + 之后三条 file 断言（mock 调用是瞬时的，1.5s 远大于落盘需要；若实现把 keep 记成
  异步更晚，这里会如实判红而不是假绿——file 断言的输入是真实文件内容）。

## 已知边界

- 改名（rename）路径不在本场景：场景 163 判 initial、本场景判 keep；「已有标题 + rename 改掉
  标题」由 Rust 单测 `harness::title::tests::parse_*` + `schedule_*` 覆盖。
- 漂移提前重估的全分支留 Rust 单测（真机驱动 5+ 轮成本高、判别力不增，design D14）。
