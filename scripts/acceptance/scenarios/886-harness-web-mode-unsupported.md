---
# change web-evidence-provenance-nov26：DeepSeek 只有 full 能力，selected_chunks 必须失败关闭。
# 验收 vault 配一个占位 Key 的 DeepSeek 条目（provider 解析成功），能力检查在任何网络动作前
# 失败：web_mode_unsupported、attempts=0、local_precheck=false、无批准卡、无证据徽标。
# 占位 Key 不会发出任何请求（能力检查先于预检与 provider 请求）。
id: "886-harness-web-mode-unsupported"
item: 886
tier: full
title: Web 不支持的模式失败关闭：web_mode_unsupported、无批准卡、无徽标、零读数
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-web-mode-unsupported.json"
    rawProviders:
      deepseek-work:
        preset: deepseek
        api_key: "acceptance-dummy"
    # 能力检查必须前移到批准预览之前：Ask 下若产生卡片，本轮会挂起、`WEB-MODE-DONE` 永不出现。
    # 「无批准卡」因此由「Ask + done 标记到达」语言无关地证明，不靠匹配中文卡标题。
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
  - name: 发送 selected_chunks 抓取提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|webmode" }
    text: "webmode"
  - name: 发送
    do: key
    key: enter
  - name: 等循环收尾
    do: waitFor
    waitFor:
      has: ["WEB-MODE-DONE"]
    timeoutMs: 30000
    expect:
      - label: 不产生批准卡（Ask 下 done 标记能到达即证明本轮未被卡住）
        ax: { not: "要抓取这个网页吗？" }
  - name: 工具行显示稳定错误码且不伪造证据
    expect:
      - label: 工具行在册
        ax: { has: "web_fetch" }
      - label: 默认行显示原始输入 URL
        ax: { has: "https://example.com/a" }
      - label: 稳定错误码
        ax: { has: "web_mode_unsupported" }
      - label: 失败不显示证据徽标（文档提取）
        ax: { not: "文档提取 · 完整性未验证" }
      - label: 失败不显示证据徽标（相关段落）
        ax: { not: "相关段落" }
      - label: 任何路径不出现「全文」
        ax: { not: "全文" }
      - label: 失败不显示条数读数
        ax: { not: "条结果" }
      - shot: 01-不支持模式
  - name: 展开「查看详情」核对审计事实
    do: click
    target: { role: AXButton, name: "^查看详情$" }
    expect:
      - label: 尝试次数行在场
        ax: { has: "尝试次数" }
      - label: 抓取方为空（无本地抓取值）
        ax: { not: "抓取方" }
      - label: 证据形态为空
        ax: { not: "证据形态" }
  - name: JSONL 精确断言零 attempts 与失败关闭
    expect:
      - label: attempts=0、local_precheck=false、code=web_mode_unsupported 同一条
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: web_fetch
            has:
              ok: false
              code: web_mode_unsupported
              attempts: 0
              local_precheck: false

---

# 886 —— 不支持的模式失败关闭

DeepSeek Fetch 只有 `full` 能力。`selected_chunks` 在 provider 解析成功后被能力检查拦下：
`web_mode_unsupported`、`attempts=0`、`local_precheck=false`，零目标连接、零 provider 请求、
无批准卡。失败行不显示证据徽标（`文档提取 · 完整性未验证` / `相关段落`），详情不出现证据形态 /
完整性 / 抓取方 / 绑定 / 最终 URL。

判据只覆盖 GUI 可达的失败路径；`selected_chunks + bounded` 的成功链由
`src-tauri/tests/web_acceptance.rs` 与 `tests/unit` 的 DOM 断言覆盖（生产装配没有可用的 Web
provider，成功 Fetch 在真机不可达）。
