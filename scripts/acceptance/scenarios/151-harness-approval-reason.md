---
id: "151-harness-approval-reason"
item: 151
title: 批准卡判定依据行（M459）：危险黑名单 / 模式默认分层 / deny 规则原文三类拦截各说得出理由（mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-approval-reason.json"
    permissions:
      allow: []
      deny: ["cli(npm run deploy*)"]
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键/错键会显著加剧——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送（本场景只发这一条消息——见「已知边界」的键盘注入口径）
    do: keys
    keys: ["r", "e", "a", "s", "o", "n"]
  - name: 发送
    do: key
    key: enter

  - name: 等第一张批准卡（zsh 包装器 = 危险黑名单 → vault_write 档照样问）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    timeoutMs: 30000
    expect:
      - label: 判定依据行在场且为 shell 包装器句（D459，点名包装器命令名）
        ax: { has: "shell 包装器命令（zsh）：内容不可知，任何权限档都需逐个确认" }
      - label: 命令原文完整可见（依据行是解释，不替代命令）
        ax: { has: "zsh -lc echo HNA-WRAP" }
      - label: 段B 的用法没有被错挂到第一张卡上
        ax: { not: "当前为 保险库写入 档" }
      - shot: 01-包装器判定依据

  - name: 拒绝这一条（危险命令不执行）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第二张批准卡（vault_write 档下的库外写命令 = 模式默认分层）
    do: waitFor
    waitFor:
      has: ["装一个依赖"]
    timeoutMs: 30000
    expect:
      - label: 判定依据行带当时档位与该档释义（D458；{desc} 与浮层释义同源）
        ax: { has: "当前为 保险库写入 档：库内写自动放行；库外命令先问你" }
      - label: 命令原文完整可见
        ax: { has: "npm install" }
      - shot: 02-模式分层判定依据

  - name: 拒绝这一条（不造真副作用）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第三段收尾（deny 规则命中：直接拒绝、不进批准闸）
    do: waitFor
    waitFor:
      has: ["部署被规则挡住了。"]
    timeoutMs: 30000
    expect:
      - label: 工具行给出**命中的规则原文**（M459：deny 的判定依据落工具行）
        ax: { has: "命中 deny 规则 cli(npm run deploy*)" }
      - label: deny 不产批准卡（拒绝对话不进批准闸——负向断言，卡在场时本轮不会收尾）
        ax: { not: "要运行这条命令吗？" }
      - label: 拒绝对话的细分状态与错误码在场
        ax: { has: "denied · permission_denied" }
      - label: JSONL 记下 deny 拒绝（规则原文随 function_call_output 回送模型）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_deny1".*命中 deny 规则 cli\(npm run deploy\*\).*$/' }
      - label: 两条被拒的 cli_run 都没有真跑（正文里没有它们的 stdout）
        ax: { not: "HNA-WRAP" }
      - shot: 03-deny规则原文
---

# 151-harness-approval-reason —— 批准卡的判定依据行与 deny 规则原文

## 本场景在验什么

M459（change add-approval-decision-reason）：Alex 2026-10-12 在 `vault_write` 档下收到
`zsh -lc …` 的批准询问而疑惑「档位没生效？」——裁决是**逻辑不改、把理由说出来**。本场景是
三处落点的真机判据（层级一律由 Rust 判定管线产出，前端只按 `kind` 取文案）：

| 段落 | 调用 | 拦截层 | 期望的「判定依据」 |
|---|---|---|---|
| A | `zsh -lc echo HNA-WRAP` | 危险黑名单 · shell 包装器（第 3 层） | 卡上 D459：点名 `zsh` + 说明内容不可知、任何档都问 |
| B | `npm install` | 模式默认分层（第 5 层，`vault_write` 档） | 卡上 D458：当时档位 + 该档释义（与浮层释义同源） |
| C | `npm run deploy`（命中 `cli(npm run deploy*)`） | 用户 deny 规则（第 1 层） | **不产卡**；工具行的 rejected 摘要里带规则原文 |

## fixture 的四段意图（**全部发生在同一条用户消息内**）

| 段 | 命令 | 期望 |
|---|---|---|
| A | `zsh -lc …` | 出卡：判定依据 = 包装器句；场景**拒绝**它 |
| B | `npm install` | 出卡：判定依据 = 模式分层句（带「保险库写入」档与释义）；场景**拒绝**它 |
| C | `npm run deploy` | deny 规则命中 ⇒ **不出卡**、工具行给规则原文；拒绝语义（不进闸）与 A/B 的「出卡」互证 |
| D | — | 最终答复（能到达即证明 C 段没有挂起在批准闸上） |

## 断言口径与已知边界

- **「deny 不进批准闸」的正观测有两条**：C 段的 `ax: { not: "要运行这条命令吗？" }`，加上 D 段
  必须到达（若 C 段真挂起在闸上，那句答复永远不来 ⇒ `waitFor` 超时判 FAIL）。
- **两条依据句的互斥断言**：A 段同时断言「当前为 保险库写入 档」**不在** AX 里——防「依据行
  取错层级 / 两段文案串场」这类静默错挂（只断言目标句在场会漏掉串场）。
- **规则原文的长度口径**：deny 文案把 `命中 deny 规则 {rule}` 拼在末尾，而工具行摘要按 80 字符
  截断 message——本场景的规则串足够短（拼接后 62 字符），完整可见；超长的退回既有文案（不呈现
  半截规则名）由 `src-tauri/src/harness/turn.rs` 的单测钉，不在真机判。
- **不判批准闸的内部状态**：判定依据来自事件 / 快照两条通道，真机侧的可判读数就是卡上文本与
  工具行文本；层级映射的真值表在 `src-tauri/src/harness/permissions.rs` 的单测里。
- **键盘口径同 110**：场景只发一条消息，避开 KimiCU 逐键注入在多段输入下的丢键面
  （REVIEW.md 第 11 条）。
