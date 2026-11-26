---
id: "732-harness-lazy-restore-unpublished-guard"
item: 732
tier: full
title: 未发布批次守卫：发布仍失败拒绝切换与新会话；权限恢复后旧 pending 恰好发布一次再执行
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-lazy-send.json"
seed:
  registry:
    - { id: acc-lazy, path: $vault, lastOpenedAt: 1757000002000 }
  harnessSessions:
    - vaultId: acc-lazy
      name: s100000-lazy-a.jsonl
      raw: |
        {"ts":100000,"payload":{"kind":"session_open","session_id":"s100000-lazy-a","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":100001,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"甲问题"}]}]}}}
        {"ts":100002,"payload":{"kind":"llm_response","text":"甲回答"}}
        {"ts":100003,"payload":{"kind":"session_title","title":"查看甲","decision":"initial","reason":"first-turn"}}
        {"ts":100004,"payload":{"kind":"subrun","run_id":"run-lazy-a","agent":"research","description":"甲后台任务","status":"completed","model":"mock-model","usage":{"input_tokens":1,"cached_tokens":0,"output_tokens":1}}}
        {"ts":100005,"payload":{"kind":"notice_delivered","run_ids":["run-lazy-a"],"wake_batch":"batch-lazy-a","shown_at":100005}}
    - vaultId: acc-lazy
      name: s200000-lazy-b.jsonl
      raw: |
        {"ts":200000,"payload":{"kind":"session_open","session_id":"s200000-lazy-b","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":200001,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"乙问题"}]}]}}}
        {"ts":200002,"payload":{"kind":"llm_response","text":"乙回答"}}
        {"ts":200003,"payload":{"kind":"session_title","title":"查看乙","decision":"initial","reason":"first-turn"}}
        {"ts":200004,"payload":{"kind":"subrun","run_id":"run-lazy-b","agent":"research","description":"乙后台任务","status":"completed","model":"mock-model","usage":{"input_tokens":1,"cached_tokens":0,"output_tokens":1}}}
        {"ts":200005,"payload":{"kind":"notice_delivered","run_ids":["run-lazy-b"],"wake_batch":"batch-lazy-b","shown_at":200005}}
steps:
  - name: 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 打开历史浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等 A 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看甲/"]
    timeoutMs: 15000
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲" }
  - name: 等 A 重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 会话目录只读
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o500
  - name: 输入首轮真实消息
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|切换守卫" }
    text: "切换守卫"
  - name: 发送
    do: key
    key: enter
  - name: 等回答完成但发布失败
    do: waitFor
    waitFor:
      has: ["LAZY-OK", "对话暂未保存"]
    timeoutMs: 30000
  - name: 打开浮层尝试切到 B
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 等 B 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看乙/"]
    timeoutMs: 15000
  - name: 点击 B（旧 pending 发布仍失败，应拒绝）
    do: clickInNode
    target: { role: AXMenuItem, name: "查看乙" }
  - name: 等可见持久化错误
    do: waitFor
    waitFor:
      has: ["不能切换或新建会话"]
    timeoutMs: 10000
    expect:
      - label: 旧 transcript 保留
        ax: { has: "切换守卫" }
      - label: 旧 pending 未发布，目录仍只有 A/B 源文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
  - name: 恢复目录写权限
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o700
  - name: 再开浮层点击 B
    do: click
    target: { role: AXPopUpButton, name: "查看甲" }
  - name: 等 B 的历史行再次出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看乙/"]
    timeoutMs: 15000
  - name: 再次点击 B（先发布旧 pending，再切换）
    do: clickInNode
    target: { role: AXMenuItem, name: "查看乙" }
  - name: 等 B 视图
    do: waitFor
    waitFor:
      has: ["乙回答"]
    timeoutMs: 15000
    expect:
      - label: 旧 pending 恰好发布一次后出现第三份文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
      - label: 旧 pending 的请求响应各一份
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - label: 新视图确实属于 B
        ax: { not: "切换守卫" }

  - name: 再查看 A，构造新会话守卫现场
    do: click
    target: { role: AXPopUpButton, name: "查看乙" }
  - name: 等 A 的历史行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(查看甲/"]
    timeoutMs: 15000
  - name: 查看 A
    do: clickInNode
    target: { role: AXMenuItem, name: "查看甲", nth: 0 }
  - name: 等 A 重建
    do: waitFor
    waitFor:
      has: ["甲回答"]
    timeoutMs: 15000
  - name: 再次只读会话目录
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o500
  - name: 输入新会话守卫消息
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|新会话守卫" }
    text: "新会话守卫"
  - name: 发送
    do: key
    key: enter
  - name: 等回答与未保存告警
    do: waitFor
    waitFor:
      has: ["LAZY-OK", "对话暂未保存"]
    timeoutMs: 30000
  - name: 等本轮协议释放（发送钮回到发送态）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000
  - name: 点击新会话（发布仍失败，应拒绝且不清视图）
    do: click
    target: { role: AXButton, name: "^新会话$" }
  - name: 等新会话拒绝错误
    do: waitFor
    waitFor:
      has: ["不能切换或新建会话"]
    timeoutMs: 10000
    expect:
      - label: 当前 transcript 与 composer 历史未清
        ax: { has: "新会话守卫" }
      - label: 没有新增第四份文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 3 }
  - name: 恢复目录写权限
    do: envChmod
    file: "harness/sessions/acc-lazy"
    mode: 0o700
  - name: 再点新会话（先发布旧 pending，再重置）
    do: click
    target: { role: AXButton, name: "^新会话$" }
  - name: 等新空会话
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000
    expect:
      - label: 旧 pending 发布后才有第四份文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 4 }
      - shot: 01-守卫后发布再执行
---

# 732 —— 未发布批次守卫

两次权限故障分别覆盖“查看另一历史”和“显式新会话”。被拒时保留旧 transcript 与健康；恢复权限后的同一动作先发布旧 pending，再执行切换或重置。
