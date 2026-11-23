---
# change add-harness-turn-retry-nov23 A1：已受理的用户消息因网络层发送失败终态后，错误行给出
# 「重试」动作；点击后在**同一会话、同一逻辑轮次**里只重发失败的那一次 provider 往返。
# 判据：重试请求是同一 JSONL 里新增的一对记录（`llm_request` 恰 2 条、`session_open` 恰 1 条），
# 用户气泡不重复（唯一性问题归 R4 的逐字节断言；本层判「没有多一条用户消息在屏幕上」靠
# 错误行 / 动作 / 回答的可见面）。
id: "710-harness-retry-network"
item: 710
tier: core
title: 失败轮显式重试（网络失败）：错误行动作 → 点击 → 同一会话重发一次 → 回答上屏、记录只多一对
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-network.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入整批丢键 / 错键会显著加剧——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|retrymsg" }
    text: "retrymsg"
  - name: 发送
    do: key
    key: enter

  - name: 等失败终态上屏（网络层失败的人话错误行）
    do: waitFor
    waitFor:
      has: ["错误：LLM 请求发送失败"]
    timeoutMs: 30000
    expect:
      - label: 错误行在场（D348 包 D355，人话、不含内部 URL / reqwest 原始串）
        ax: { has: "/错误：LLM 请求发送失败：请检查网络连接/" }
      - label: 错误行上有且只有一个「重试」动作（后端分类判可重试）
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - shot: 01-失败态与重试动作

  - name: 点击重试（只发一次失败往返）
    do: click
    target: { role: AXButton, name: "^重试$" }

  - name: 等重试成功、回答上屏
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - label: 新回答上屏
        ax: { has: "RETRY-OK" }
      - label: 动作随成功收尾消失
        node: { role: AXButton, name: "^重试$", present: false }
      - label: 同一 JSONL 只多一对请求 / 响应（失败请求 + 重试请求 = 2 条 llm_request）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 2 } }
      - label: 重试不新建会话文件（没有第二条 session_open / 第二个文件）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"session_open"', exact: 1 } }
      - shot: 02-重试成功
---

# 710-harness-retry-network —— 网络失败后的显式重试

## 本场景在验什么

- **动作在场**：可重试失败（网络层）在错误行上给出「重试」；不可重试失败没有动作（A6）。
- **原地补发**：点击后重发失败的那一次 provider 往返——同一 JSONL 新增一对 `llm_request` /
  `llm_response`，不写第二条 `session_open`、不新建文件。
- **成功收尾**：重试成功的回答正常上屏，动作消失。

## 判据为什么这样写

- `count: exact 1` 判动作数量（同一条错误行只有一枚钮）；`node present:false` 判成功后动作
  消失（缺键 / 没渲染 / 被别的文本冒充三种形态都能区分）。
- JSONL 计数用 `file.count` 在 `env:harness/sessions/*/*.jsonl` 上按 `"kind":"llm_request"`
  数——失败请求与重试请求合计恰 2 条；`session_open` 恰 1 条证明重试没有新建会话文件。
- 网络失败的 `message` 含内部 URL / reqwest 原始串，上屏文案走文案表（D355）——断言正向在场
  的句子就是 D355 的首句，反向不写（避免把整句抄进场景）。

## 覆盖边界（如实登记）

- 「用户气泡只有一条」的逐字节判据归 R4（`retry_resends_identical_messages_in_same_session`：
  两次 `llm_request.messages` 逐字节相等 + 用户消息条数不变）。AX 里没有可数的 user 气泡节点
  （正文静态文本不承担容器身份），本层不宣称覆盖。
- 连点 / 并发只重发一次归 A3（`710` 系）与 R6 的守卫断言。
- 切换 provider / model 后重试归 R4b（真机切换需要真实 provider 的可用请求，本层不覆盖）。
- 半截正文归 A9；空响应归 A8；新写工具批准归 A10；vision 拒绝归 A11。
