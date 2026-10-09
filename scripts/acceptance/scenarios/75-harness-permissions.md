---
id: "75-harness-permissions"
item: 75
title: Harness ⑥ 权限规则：deny 命中直接拒绝（deny > allow）、allow 命中免闸（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-permissions.json"
    permissions:
      allow: ["cli(*)"]
      deny: ["cli(rm *)"]
steps:
  - name: 记下基线（rm 绝不能真跑：内容与 mtime 双判据）
    do: record
    as: before
    file: harness-note.md

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["p", "e", "r", "m", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等两个 cli_run 都收尾（同一轮里的两个工具调用）
    do: waitFor
    waitFor:
      has: ["权限验收回答：一拒一放。"]
    expect:
      - label: 两个调用都没进批准闸（cli 默认 ask，规则命中后不再问）
        ax: { not: "要运行这条命令吗？" }
      - label: rm 没有真跑——文件内容逐字节不变
        file: { path: harness-note.md, unchangedSince: before }
      - label: rm 没有真跑——mtime 未推进
        file: { path: harness-note.md, mtimeUnchangedSince: before }
      - label: JSONL 记下 deny 拒绝（permission_denied + 主体串，随 function_call_output 回送模型）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"call_id":"call_d1".*permission_denied.*rm harness-note\.md.*$/' }
      - label: JSONL 记下 echo 执行（allow 的结果 stdout，随 function_call_output 回送模型）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"call_id":"call_a1".*HNE-ALLOWED.*$/' }

  - name: 展开工具清单（M351 起 ≥2 行的轮次终态折叠为一行摘要钮，步骤行 hidden 不进 AX）
    do: click
    target: { role: AXButton, name: "个工具调用 · 全部完成" }
    expect:
      - label: rm 被 deny 规则拒掉（同时命中 allow 的 cli(*)——deny 优先）
        ax: { has: "/denied · permission_denied/" }
      - label: echo 命中 allow 直接执行成功（成功行 = 工具徽章 + 人话化参数；M406 起 JSON 摘要不上屏）
        ax: { has: '/cli_run\s*echo HNE-ALLOWED/' }
      - shot: 01-一拒一放
---

spec 判据（harness「权限机制 · deny 优先」）：一条 cli_run 同时匹配 allow 与 deny 规则时
被拒绝并把原因回送模型、不进入批准闸；allow 命中免批准执行。fixture 在同一轮里发两个
cli_run：rm（同时命中 cli(*) 与 cli(rm *)）与 echo（只命中 cli(*)）。「没进闸」这条
负向断言的正观测 = 两条工具行都在场（一拒一放：失败行保留状态与错误码尾注、成功行为工具徽章加人话化参数）。

M351（change harness-pane-visual-fidelity）起 ≥2 行的工具清单在轮次终态折叠为一行摘要钮
（D387「{count} 个工具调用 · 全部完成」），折叠态步骤行 `hidden` 不进 AX 树——因此工具行
断言必须先点摘要钮展开（单工具轮次不折叠，场景 71/72/77 的断言不受此影响）。
