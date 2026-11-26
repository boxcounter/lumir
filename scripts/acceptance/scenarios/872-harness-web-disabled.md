---
# change add-harness-web-fetch-search-nov24 阶段5：总开关关闭时 Web 工具不注册。
# change compact-web-search-result-summary-nov26：默认行只留 tool_unknown，审计在「查看详情」。
id: "872-harness-web-disabled"
item: 872
tier: full
title: web_access.enabled=false：Web 工具不注册，幻觉调用回送 tool_unknown，无批准卡
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-search.json"
    web_access:
      enabled: false
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
  - name: 发送 Web 搜索提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|webdisabled" }
    text: "webdisabled"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-SEARCH-DONE"]
    timeoutMs: 30000
    expect:
      - label: 关闭后没有批准卡
        ax: { not: "要搜索网页吗？" }
  - name: 单 Web 调用默认行显示未知工具，不出组摘要
    expect:
      - label: 幻觉调用按未知工具拒绝
        ax: { has: "tool_unknown" }
      - label: 单次调用不出组摘要
        ax: { not: "个工具调用 · 全部完成" }
      - shot: 01-关闭Web工具默认行
  - name: 展开「查看详情」核对未配置 / 0 尝试
    do: click
    target: { role: AXButton, name: "^查看详情$" }
    expect:
      - label: 审计记录实际未配置 / 0 尝试
        ax: { has: "尝试次数" }
      - label: provider 未解析
        ax: { has: "未解析" }
      - shot: 02-关闭Web工具详情
  - name: JSONL 结果 code 是 tool_unknown
    expect:
      - label: 关闭时不解析 provider
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_search
            has:
              ok: false
              code: tool_unknown
---

# 872 —— web_access.enabled=false

总开关关闭后两件 Web 工具不注册；模型仍可能幻觉调用，运行时按清单外工具回送 `tool_unknown`，
不产生批准卡、不解析 provider、不发起网络请求。
