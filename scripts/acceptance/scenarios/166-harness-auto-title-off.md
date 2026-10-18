---
id: "166-harness-auto-title-off"
item: 166
title: 会话自动命名④：autoTitle=false 时不发起调用、不写标题记录（会话名走回落口径）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 关闭开关。fixture **仍然带有 titles 脚本**——若开关被忽略，标题会照常生成、标题栏会换名，
  # 两条断言因此都有区分度（不是「没有脚本所以没标题」的空转）。
  autoTitle: false
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-title-initial.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqaunttwo" }
    text: "zqaunttwo"
  - name: 发送
    do: key
    key: enter
  - name: 等回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：标题已生成。"]
    timeoutMs: 30000
    expect:
      - label: 回答渲染（回合真实完成，命名判定才有意义）
        ax: { has: "验收回答：标题已生成。" }

  - name: 等命名窗口过去（若开关被忽略，mock 调用是瞬时的，这里足够它落盘）
    do: sleep
    ms: 1500
    expect:
      - label: 会话名走回落口径（首条用户消息），没有换成 fixture 里的标题
        ax: { has: "/AXPopUpButton \\(zqaunttwo/" }
      - label: 关闭后 MUST NOT 写 session_title 记录（fixture 有 titles 脚本也一份不写）
        file: { path: "env:harness/sessions/*/*.jsonl", not: '"kind":"session_title"' }
      - label: 会话留存照常落 wire 记录（证明文件存在、上面的 not 断言有输入而非空转）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"kind":"session_open"' }
      - shot: 01-关闭开关
---

# 166-harness-auto-title-off —— 关闭开关（change add-session-auto-naming 5.3④）

## 本场景在验什么

`autoTitle: false` 时：不发起任何命名调用、不写 `session_title` 记录；会话名按「会话边界」条
的回落口径显示（首条用户消息截断）。

## 区分度（REVIEW.md「断言等价于子串」条）

fixture **仍然声明 `titles` 脚本**。若实现只是「没有脚本所以没标题」，本场景会假绿；带脚本的
fixture 让「开关真的被消费」成为唯一能让断言通过的解释——开关被忽略时标题栏会换成 fixture
里的标题、留存里会出现 `decision=initial`。

## 断言口径

- 标题栏断言锚 `AXPopUpButton`（会话名钮的 role 分流），避免与 transcript 里的同名文本混淆；
  这里比对的是**首条用户消息** `zqaunttwo`。
- `not: '"kind":"session_title"'` 与同一文件上的 `has: '"kind":"session_open"'` 配对使用：前者
  是负向断言，后者证明文件真实存在且非空——否则负向断言可能对着一个不存在的文件空过
  （REVIEW.md「读不到当成空」条）。
- 1.5s 等待覆盖轮后后台线程的落盘窗口；若实现把调用挂在更晚的位置，本场景会判红（那正是
  开关没生效的形态）。
