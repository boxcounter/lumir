---
id: "77-harness-skill-load"
item: 77
title: Harness ⑧ Skill：索引发现 + skill_load 按需加载 + 根外名拒绝（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-skill.json"
steps:
  - name: 造 vault-wide Skill（<vault>/.agents/skills/probe-skill/SKILL.md）
    do: vaultWrite
    file: .agents/skills/probe-skill/SKILL.md
    content: |
      ---
      description: 验收探针技能（M304 场景 77）
      ---

      # 探针技能

      技能密令：HSK-SECRET-7429。看到本行即证明 skill_load 读到了全文。
    expect:
      - label: SKILL.md 已落盘
        file: { path: .agents/skills/probe-skill/SKILL.md, exists: true }

  - name: 等 watcher 收敛（外部写入后先留一拍再读 AX，README 口径）
    do: sleep
    ms: 1200

  - name: ⌘⇧A 打开 harness pane（旁侧分栏；首次发送才建会话——Skill 发现发生在会话建立与本轮工具解析时）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["s", "k", "i", "l", "l", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等两个 skill_load 收尾（越界名被拒 + 正常名成功）
    do: waitFor
    waitFor:
      has: ["验收回答完毕。"]
    expect:
      - label: 回答用上了技能内容（密令来自 SKILL.md 全文）
        ax: { has: "HSK-SECRET-7429" }
      - label: 回送模型的 function_call_output 带回 SKILL.md 全文（密令只在文件里）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*HSK-SECRET-7429.*"type":"function_call_output".*$/' }

  - name: 展开工具清单（M351 起 ≥2 行的轮次终态折叠为一行摘要钮，步骤行 hidden 不进 AX）
    do: click
    target: { role: AXButton, name: "个工具调用 · 全部完成" }
    expect:
      - label: 根外技能名被拒（路径逃逸拒绝）
        ax: { has: "/error · skill_name_invalid/" }
      - label: 正常技能加载成功（成功行 = 调用参数摘要；M368 起模板「工具 {name}：{summary}」）
        ax: { has: '工具 skill_load：{"name":"probe-skill"}' }
      - shot: 01-skill 加载
---

spec 判据（harness「Skill 支持 · 索引注入与按需加载」+「路径逃逸拒绝」）：vault-wide
Skill 根下的技能经 skill_load 按名加载全文；指向根外的名字拒绝并回送错误。
判据说清两处边界：① 「索引注入系统上下文」本身在真机无直接观测口（mock 不转述
system）——索引装配由 Rust 单测覆盖（context.rs 的
assemble_system_skips_missing_agents_and_includes_index），本场景断言它的下游可观测
事实：skill_load 按名命中 vault-wide 根（发现链路成立）且全文回送模型；② skill 必须
在首次发送前落盘——会话在首次发送时建立、 Skill 发现随会话装配与每轮工具解析发生。

M351（change harness-pane-visual-fidelity）起 ≥2 行的工具清单在轮次终态折叠为一行摘要钮
（D387「{count} 个工具调用 · 全部完成」），折叠态步骤行 `hidden` 不进 AX 树——本场景一轮
两个 skill_load（越界名 + 正常名），工具行断言必须先点摘要钮展开（2026-10-07 批次实证：
未展开时两条工具行断言全红）。
