---
# change add-harness-web-fetch-search-nov24 阶段5：Web 不可用不自动降级 curl；后续 curl 仍按原权限进闸。
id: "873-harness-web-no-auto-curl"
item: 873
tier: full
title: Web 关闭/失败不自动降级 curl：后续 curl 仍进批准闸，拒绝后零副作用
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-call-then-curl.json"
    permission_mode: read_only
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
  - name: 发送「先 Web 再 curl」提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|webfallback" }
    text: "webfallback"
  - name: 发送
    do: key
    key: enter
  - name: 等 curl 批准闸（Web 失败不得自动执行 curl）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    timeoutMs: 30000
    expect:
      - label: curl 仍走原权限闸
        ax: { has: "要运行这条命令吗？" }
      - label: 命令原文可见
        ax: { has: "curl https://example.com/a" }
      - label: Web 工具未注册（未知工具）
        ax: { has: "tool_unknown" }
      - shot: 01-curl仍进闸
  - name: 拒绝 curl
    do: click
    target: { role: AXButton, name: "^拒绝$" }
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-FALLBACK-DONE"]
    timeoutMs: 30000
  - name: 展开工具清单（三项：Web 审计 + curl 已决行）
    do: click
    target: { role: AXButton, name: "个工具调用 · 全部完成" }
    expect:
      - label: curl 被拒绝
        ax: { has: "已拒绝" }
      - label: Web 未注册在工具行可见
        ax: { has: "tool_unknown" }
  - name: JSONL：Web 失败 + curl 拒绝各一条
    expect:
      - label: Web 未注册
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_search
            has: { ok: false, code: tool_unknown }
      - label: curl 批准拒绝
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            has: { ok: false, code: approval_rejected }
---

# 873 —— Web 失败不自动降级 curl

Web 工具不可用时，模型可以另行选择 curl，但该调用仍走既有 CLI 权限与批准闸；系统不得自动
把 Web 请求翻译成 curl。拒绝后命令不执行（文件 / mtime 不变）。
