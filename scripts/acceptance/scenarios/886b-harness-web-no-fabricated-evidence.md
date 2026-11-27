---
# change web-evidence-provenance-nov26：失败的 Fetch 不得伪造五个证据读数。
# 未配置任何 Web provider：full 模式在 provider 解析处失败（web_provider_unconfigured），
# 面板不显示证据徽标、详情不出现证据形态 / 完整性 / 抓取方 / 绑定 / 最终 URL。
id: "886b-harness-web-no-fabricated-evidence"
item: 886
tier: full
title: Web 失败不伪造证据读数：未配置 provider 无徽标、五字段不渲染
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-no-fabricated.json"
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
    target: { role: AXTextArea, name: "问点什么|webfab" }
    text: "webfab"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-NO-FABRICATED-DONE"]
    timeoutMs: 30000
  - name: 失败行不显示证据徽标
    expect:
      - label: 稳定错误码
        ax: { has: "web_provider_unconfigured" }
      - label: 无文档提取徽标
        ax: { not: "文档提取 · 完整性未验证" }
      - label: 无相关段落徽标
        ax: { not: "相关段落" }
      - label: 无「全文」
        ax: { not: "全文" }
      - shot: 01-未配置无徽标
  - name: 详情不伪造五字段
    do: click
    target: { role: AXButton, name: "^查看详情$" }
    expect:
      - label: 无证据形态行
        ax: { not: "证据形态" }
      - label: 无完整性行
        ax: { not: "完整性" }
      - label: 无抓取方行
        ax: { not: "抓取方" }
      - label: 无绑定行
        ax: { not: "绑定" }
      - label: 无最终 URL 行
        ax: { not: "最终 URL" }

---

# 886b —— 失败不伪造证据读数

未配置任何 Web provider 时，`full` 模式在 provider 解析处失败（`web_provider_unconfigured`）。
面板不显示证据徽标，详情不渲染证据形态 / 完整性 / 抓取方 / 绑定 / 最终 URL：五字段为 null 时
必须整行缺席，而不是补默认值。
