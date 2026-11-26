---
# change add-harness-web-fetch-search-nov24 阶段5：默认 allow_all 无卡审计（失败路径）。
# change compact-web-search-result-summary-nov26：默认行只留纯 query + 稳定错误码，provider /
# attempts / untrusted 收进默认关闭的「查看详情」；单次 Web 调用不出组摘要。
id: "869-harness-web-default-audit"
item: 869
tier: full
title: Web 默认无卡审计：未配置 provider 仍显示 query / provider / attempts / untrusted，无批准卡
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-search.json"
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
    target: { role: AXTextArea, name: "问点什么|websearch" }
    text: "websearch"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-SEARCH-DONE"]
    timeoutMs: 30000
    expect:
      - label: 默认 allow_all 不产生批准卡
        ax: { not: "要搜索网页吗？" }
  - name: 单 Web 调用保持展开，默认行显示纯 query 与稳定错误码
    expect:
      - label: 工具行在册
        ax: { has: "web_search" }
      - label: 默认行显示纯 query（不显示 arguments JSON / 默认参数）
        ax: { has: "stage5 web audit" }
      - label: 失败直接显示稳定错误码
        ax: { has: "web_provider_unconfigured" }
      - label: 单次 Web 调用不出组摘要（审计不计为另一次调用）
        ax: { not: "个工具调用 · 全部完成" }
      - label: 失败不显示条数 / 大小
        ax: { not: "条结果" }
      - shot: 01-默认紧凑行
  - name: 展开「查看详情」核对完整审计
    do: click
    target: { role: AXButton, name: "^查看详情$" }
    expect:
      - label: 完整 query 在详情内回看
        ax: { has: "stage5 web audit" }
      - label: 审计显示实际尝试次数 0
        ax: { has: "尝试次数" }
      - label: provider 未解析，不伪造身份
        ax: { has: "未解析" }
      - label: untrusted 说明在详情内
        ax: { has: "untrusted data" }
      - shot: 02-查看详情
  - name: JSONL 里同一条结果带零 attempts 与事实审计
    expect:
      - label: 结果 code / attempts / local_precheck / provider_fetch 同一条
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_search
            has:
              ok: false
              code: web_provider_unconfigured
              attempts: 0
              local_precheck: false
              query: stage5 web audit
---

# 869 —— 默认无卡审计（未配置 provider）

判据落在「没有批准卡」「单调用不出组摘要」「失败行不显示条数 / 大小」与「详情仍保留完整审计」
四件事上：`web_search` 在解析 provider 前失败，默认行给出纯 query 与稳定错误码，展开「查看详情」
后仍能回看 provider 未解析、attempts=0、untrusted。成功链路的合成 HTTP 证据
在 Rust `web_acceptance` 集成测试（`--features acceptance-web`），本场景只守真机 UI 面。
