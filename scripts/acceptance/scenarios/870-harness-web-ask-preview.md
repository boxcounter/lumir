---
# change add-harness-web-fetch-search-nov24 阶段5：Ask 预览与拒绝。
# 无 DeepSeek provider；Ask 仍要先展示完整 URL / origin / provider 状态 / 双路外发 / 费用 /
# untrusted。拒绝后不执行、不产生审计块。
id: "870-harness-web-ask-preview"
item: 870
tier: full
title: Web Ask 预览：完整 URL / origin / provider / 双路外发 / 费用 / untrusted；拒绝不执行
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-fetch.json"
    web_access:
      approval: ask
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: pane 在位
        ax: { has: "分隔条" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送 Web Fetch 提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|webask" }
    text: "webask"
  - name: 发送
    do: key
    key: enter
  - name: 等批准卡
    do: waitFor
    waitFor:
      has: ["要抓取这个网页吗？"]
    timeoutMs: 30000
    expect:
      - label: 完整 URL
        ax: { has: "https://example.com/a" }
      - label: 规范化 origin
        ax: { has: "https://example.com" }
      - label: provider 未解析
        ax: { has: "未解析" }
      - label: 双路外发说明（预检 + DeepSeek）
        ax: { has: "HEAD / Range GET" }
      - label: 费用
        ax: { has: "5 元 / 1000 次" }
      - label: untrusted
        ax: { has: "untrusted" }
      - label: 不是命令闸
        ax: { not: "要运行这条命令吗？" }
      - shot: 01-Ask预览
  - name: 拒绝
    do: click
    target: { role: AXButton, name: "^拒绝$" }
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-FETCH-DONE"]
    timeoutMs: 30000
    expect:
      - label: 终态行是已拒绝
        ax: { has: "已拒绝" }
      - label: 拒绝调用没有执行审计块
        ax: { not: "尝试次数" }
  - name: JSONL 记录拒绝且无 Web 执行结果
    expect:
      - label: cli / Web 结果只有 approval_rejected
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_fetch
            has:
              ok: false
              code: approval_rejected
---

# 870 —— Ask 预览与拒绝

预览与执行前的批准卡同源；拒绝路径只回送 `approval_rejected`，不产生 Web 审计块（没有执行）。
