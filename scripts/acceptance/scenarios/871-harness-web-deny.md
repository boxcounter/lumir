---
# change add-harness-web-fetch-search-nov24 阶段5：deny 优先且不产生网络请求。
# change compact-web-search-result-summary-nov26：单调用不出组摘要，attempts / 外发事实在
# 默认关闭的「查看详情」里。
id: "871-harness-web-deny"
item: 871
tier: full
title: Web deny：deny 规则直接拒绝、不预检、不请求 provider，审计不写外发说明
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-fetch.json"
    permissions:
      deny: ["web_fetch(https://example.com)"]
    web_access:
      approval: allow_all
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
    target: { role: AXTextArea, name: "问点什么|webdeny" }
    text: "webdeny"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-FETCH-DONE"]
    timeoutMs: 30000
    expect:
      - label: deny 不进批准闸
        ax: { not: "要抓取这个网页吗？" }
  - name: 单 Web 调用默认行显示拒绝，不出组摘要
    expect:
      - label: 工具行显示拒绝
        ax: { has: "permission_denied" }
      - label: 单次 Web 调用不出组摘要（审计不计为另一次调用）
        ax: { not: "个工具调用 · 全部完成" }
      - shot: 01-deny默认行
  - name: 展开「查看详情」核对零尝试与无外发
    do: click
    target: { role: AXButton, name: "^查看详情$" }
    expect:
      - label: 审计记录 attempts=0
        ax: { has: "尝试次数" }
      - label: 未发生外发，不显示预检 + DeepSeek 外发说明
        ax: { not: "HEAD / Range GET" }
      - shot: 02-deny详情
  - name: JSONL 审计事实与拒绝同一条
    expect:
      - label: permission_denied + local_precheck=false + provider_fetch=false
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_fetch
            has:
              ok: false
              code: permission_denied
              attempts: 0
              local_precheck: false
---

# 871 —— deny 优先

工具级 deny 在预检之前拒绝；审计里 `local_precheck` / `provider_fetch` 都是 false，页面与
provider 都没有被访问。合成 HTTP 的零请求证据在 Rust `web_acceptance` 集成测试。
