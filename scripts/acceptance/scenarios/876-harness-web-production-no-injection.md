---
# change add-harness-web-fetch-search-nov24 阶段5 / tasks 8.5：生产 dev 构建的反向验收。
# change compact-web-search-result-summary-nov26：两条真实调用 + 两个审计仍计为 2。
# 本场景由 web-production-check.sh 在设置 LUMIR_ACCEPTANCE_WEB_ENDPOINTS（指向哨兵端点）的
# 环境里跑：普通 dev 构建没有读取该变量的代码，Web 仍按「无 DeepSeek provider」失败，
# web_fetch 的 localhost 仍被 URL 规则拒绝。若验收注入被误编译进生产构建，web_search 会
# 触达哨兵并得到 network / 成功，而不是 web_provider_unconfigured。
id: "876-harness-web-production-no-injection"
item: 876
tier: full
title: 生产 dev 不激活验收注入：哨兵端点零使用、URL 规则不放宽、provider 仍只有 official
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-production-probe.json"
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
  - name: 发送生产探针提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|prodprobe" }
    text: "prodprobe"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["PRODUCTION-PROBE-DONE"]
    timeoutMs: 30000
  - name: 展开工具清单（两条真实调用；两个审计不计入）
    do: click
    target: { role: AXButton, name: "个工具调用 · 全部完成" }
    expect:
      - label: 组摘要只数真实调用（2，不是 4）
        ax: { has: "2 个工具调用" }
      - label: localhost 仍被 URL 规则拒绝
        ax: { has: "web_url_blocked" }
      - label: 没有 DeepSeek provider，Web 搜索按 official-only 装配失败
        ax: { has: "web_provider_unconfigured" }
      - shot: 01-生产无注入
  - name: JSONL 精确断言两条失败的事实
    expect:
      - label: web_fetch 未执行预检以外的任何网络，attempts=0
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_fetch
            has:
              ok: false
              code: web_url_blocked
              attempts: 0
              local_precheck: false
      - label: web_search 在解析 provider 前失败，哨兵端点零请求
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_search
            has:
              ok: false
              code: web_provider_unconfigured
              attempts: 0
              local_precheck: false
---

# 876 —— 生产 dev 不激活验收注入

运行方式（由 `web-production-check.sh` 固定执行）：

```bash
LUMIR_ACCEPTANCE_WEB_ENDPOINTS='{"deepseek":"http://127.0.0.1:9","targets":{"prod-probe.test":9}}' \
  node scripts/acceptance/run.mjs 876
```

哨兵端点故意不可达。验收注入若被普通 dev 构建编译进来，`web_search` 会走哨兵并得到
`web_network_failed` / `attempts=1`（或成功），本场景的 `web_provider_unconfigured` 断言会红。
`web_fetch` 的 localhost 目标是 URL 拒绝规则不放宽的旁证：`localhost` / `.local` / 非全局单播 IP
字面量在 provider 解析之前就被静态拒绝（`local_precheck=false`、零网络），与 provider 配置状态无关；
`run_preflight` 对每一跳仍重新执行同一套主机类判定。
