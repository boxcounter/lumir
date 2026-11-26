---
# change add-harness-turn-retry-nov23 A10：失败前一次性批准过 vault_delete A；失败后重试成功，
# 模型发起新的 vault_delete B——批准前 B 原样、批准卡再现（不复用 A 的一次性批准）、批准后
# B 恰好删除一次。
id: "719-harness-retry-approval"
item: 719
tier: full
title: 重试后的新写工具仍需批准：批准前零副作用、批准卡再现、批准后恰好一次
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-approval.json"
    # 本场景不验证 Web；显式关闭以固定工具面（阶段5回扫）。
    web_access:
      enabled: false
steps:
  - name: 准备两份待删文件
    do: vaultWrite
    file: retry-del-a.md
    content: "A-DELETE-ME\n"
  - name: 第二份
    do: vaultWrite
    file: retry-del-b.md
    content: "B-DELETE-ME\n"
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|delboth" }
    text: "delboth"
  - name: Enter
    do: key
    key: enter
  - name: 等第一次批准卡（A）
    do: waitFor
    waitFor:
      has: ["要执行这次 vault_delete 调用吗？"]
    timeoutMs: 30000
    expect:
      - label: 采纳前 A 原样存在
        file: { path: retry-del-a.md, has: "A-DELETE-ME" }
      - shot: 01-第一次批准
  - name: 采纳删除 A
    do: click
    target: { role: AXButton, name: "^采纳$" }
  - name: 等 A 删除 + 下一轮失败动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
    expect:
      - label: A 已删（一次性批准生效）
        file: { path: retry-del-a.md, exists: false }
      - label: B 未被触碰
        file: { path: retry-del-b.md, has: "B-DELETE-ME" }
  - name: 记录 B 的基线（批准前零副作用的判据）
    do: record
    as: del-b
    file: retry-del-b.md
  - name: 点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等第二次批准卡（B）——新调用必须重新问
    do: waitFor
    waitFor:
      has: ["要执行这次 vault_delete 调用吗？"]
    timeoutMs: 30000
    expect:
      - label: 批准前 B 内容逐字节不变（不复用 A 的一次性批准）
        file: { path: retry-del-b.md, unchangedSince: del-b }
      - label: mtime 也不变（没有偷偷写一次）
        file: { path: retry-del-b.md, mtimeUnchangedSince: del-b }
      # 排版证据：第二次批准卡的依据与后果为 --text-2；卡体 10/12px、决策段 8px、
      # 按钮最小 32px。第二次批准与完成态行为判据不变。
      - shot: 02-第二次批准
  - name: 采纳删除 B
    do: click
    target: { role: AXButton, name: "^采纳$" }
  - name: 等最终回答
    do: waitFor
    waitFor:
      has: ["两个都处理完了。"]
    timeoutMs: 30000
    expect:
      - label: 批准后 B 恰好删除
        file: { path: retry-del-b.md, exists: false }
      # 4 条是正确语义：① 首轮（tool_call A）→ ② 批准后携带 A 输出再往返（失败）→
      # ③ 重试（tool_call B）→ ④ 批准后携带 B 输出再往返（最终回答）。批准后的新工具结果
      # 本来就要再发一次 provider 请求，不是重复执行。
      - label: 四对记录（首轮 + 失败请求 + 重试请求 + 批准 B 后的收尾请求）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 4 } }
      - shot: 03-两次删除完成
---

# 719-harness-retry-approval —— 新写工具仍需批准

「不重放旧工具」不扩大为「后续模型不会发起新写操作」：重试成功后模型新发起的工具调用照常走
既有权限规则与批准闸。一次性批准随调用结束失效，新的 `vault_delete B` 必须重新问——
「批准前 B 原样 + mtime 不变」是零副作用的可证伪读数。
