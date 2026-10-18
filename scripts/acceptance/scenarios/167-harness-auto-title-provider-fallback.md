---
id: "167-harness-auto-title-provider-fallback"
item: 167
title: 会话自动命名⑤：titleProvider 非法值回落会话 provider（启动不失败，命名调用仍走 mock）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 闭集合外的取值：Rust 校验期回落 `null`（= 会话当前 provider）并给一条人话 warning，启动照常。
  # 静态校验**故意不挡取值**（只挡类型）——这条场景要验的正是「非法值不阻断、按回落口径照跑」。
  titleProvider: "openai"
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-title-fallback.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏；启动不失败 = 面板可用）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（非法 titleProvider 不阻断启动）
        ax: { has: "分隔条" }
      - label: 面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zqfallback" }
    text: "zqfallback"
  - name: 发送
    do: key
    key: enter
  - name: 等回答 + 标题落到标题栏（命名调用回落到会话 provider = mock，弹 titles 队列）
    do: waitFor
    waitFor:
      has: ["验收回答：标题已生成。", "/AXPopUpButton \\(非法值回落标题/"]
    timeoutMs: 30000
    expect:
      - label: 非法值回落生效后标题正常显示（若回落没发生，mock 的 titles 队列不会被消费、标题栏仍是 zqfallback）
        ax: { has: "/AXPopUpButton \\(非法值回落标题/" }
      - label: 首轮命名照常落 decision=initial（回落后的 provider 走同一条链路）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"decision":"initial"' }
      - label: 记录带本次生成的标题值
        file: { path: "env:harness/sessions/*/*.jsonl", has: "非法值回落标题" }
      - shot: 01-非法provider回落
---

# 167-harness-auto-title-provider-fallback —— `title_provider` 非法值回落（5.3⑤）

## 本场景在验什么

`[harness].title_provider` 写成闭集合外的值（`"openai"`）时：**启动不失败**，命名调用回落
到会话当前 provider（本场景 = mock），首轮后仍按 mock 的 `titles` 脚本写出 `session_title`
记录、标题栏正常显示标题。

## 断言口径

- **「回落」而不是「禁用」**：标题真的显示出来是核心判据——回落若退化成「没有 title
  provider 就不调用」，标题栏会停在 `zqfallback`，两条断言同时判红。
- **静态校验的边界**：`--check` 只挡 `titleProvider` 的**类型**（数字 / 对象会让 Rust 侧整文件
  回落），**不挡取值**——闭集合外的值正是本场景要验的现场（见 `lib/execute.mjs` 该键的注释）。
- **warning 不在判据内**：Rust 侧对非法值产生一条人话 warning（配置告警通道），本场景只判
  后果（启动成功 + 命名照跑 + 标题可见）；warning 文案的单测在 `config::tests::title_provider_invalid_falls_back_to_session_provider`。
