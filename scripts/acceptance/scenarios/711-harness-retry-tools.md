---
# change add-harness-turn-retry-nov23 A2：失败发生在工具轮之后——重试只补发失败的那次往返，
# 已执行的工具不重放：目标文件仍只有一份（内容 / mtime 不变）、transcript 工具行只出现一次、
# JSONL 只多一对记录。
id: "711-harness-retry-tools"
item: 711
tier: full
title: 失败轮重试不重放已执行工具：文件一份、mtime 不变、工具行一次、记录只多一对
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-tools.json"
    # 本场景不验证 Web；显式关闭以固定工具面（阶段5回扫）。
    web_access:
      enabled: false
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - ax: { has: "分隔条" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送「先建文件，再失败」的一轮
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|mkfile" }
    text: "mkfile"
  - name: 发送
    do: key
    key: enter
  - name: 等工具执行 + 第二轮往返失败
    do: waitFor
    waitFor:
      has: ["错误：LLM 请求发送失败"]
    timeoutMs: 30000
    expect:
      - label: 工具已执行（文件在场）
        file: { path: retry-once.md, has: "ONCE" }
      - label: 记录下工具执行后的文件基线（内容 + mtime）
        file: { path: retry-once.md, exists: true }
      - label: 重试动作在场
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - label: 工具行只出现一次（vault_create 的名字在 transcript / AX 里恰一处）
        ax: { has: "vault_create", count: { pattern: "vault_create", exact: 1 } }
      # 排版证据：工具行 12px、min-height 28px 且 height auto；错误尾注为 --text-2，
      # 参数省略、终态词保护、重试动作和工具不重放判据不变。
      - shot: 01-工具后失败
  - name: 记录文件基线
    do: record
    as: tool-file
    file: retry-once.md
  - name: 点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等重试成功
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - label: 文件内容逐字节不变（工具没有被重放）
        file: { path: retry-once.md, unchangedSince: tool-file }
      - label: 文件 mtime 不变（没有被重写一次）
        file: { path: retry-once.md, mtimeUnchangedSince: tool-file }
      - label: 工具行仍只一次
        ax: { has: "vault_create", count: { pattern: "vault_create", exact: 1 } }
      - label: JSONL 只多一对（首轮请求 + 失败请求 + 重试请求 = 3 条）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 3 } }
      - shot: 02-重试后文件未重写
---

# 711-harness-retry-tools —— 工具不重放

失败点位于 `execute_calls` 之前，失败的那次往返不可能执行工具；重试只进同一工具循环，第一条
请求即失败的那次请求。判据落在「文件内容 + mtime 都不变」与「工具行 / 记录计数不变」上。
「不重放」不扩大为「后续模型不会发起新写操作」——那部分归 A10（新写工具仍需批准）。
