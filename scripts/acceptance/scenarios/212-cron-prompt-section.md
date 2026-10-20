---
id: "212-cron-prompt-section"
item: 212
title: 提示词段在场：新会话的 system 含「定时任务」段、session_open.assembly 有 cron_reference 条目（tasks §8.6）
open: harness-note.md
marker: "HNL-ALPHA"
# 本场景只判「装配在场」：system prompt 里真有一段「定时任务」、装配清单记了 cron_reference
# 条目（路径 + exists=true + 非零字节）。段的**行为遵从度**（模型是否按纪律用工具、不手搓
# 系统级调度）归抽样观察，不做机器断言——mock provider 代表不了真实模型。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cron-prompt.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（键盘注入的前台纪律）
    do: focusWindow
    retries: 4

  - name: 在新会话里发一条消息（本次 run 的会话从空状态起 = 新建会话）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|cronprm" }
    text: "cronprm"
  - name: 发送
    do: key
    key: enter

  - name: 等本轮收尾（session_open 已随首条记录落盘）
    do: waitFor
    waitFor:
      has: ["CRON-PROMPT-PROBE 提示词段验收回答。"]
    expect:
      - label: 会话留存首行是 session_open（装配事实的载体）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"kind":"session_open"' }
      - label: 装配清单有 cron_reference 条目（来源标识）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"source":"cron_reference"' }
      - label: 条目字段齐：仓内相对路径 + exists=true + 非零字节
        file:
          path: "env:harness/sessions/*/*.jsonl"
          has: '/"source":"cron_reference","path":"src-tauri\/src\/harness\/prompts\/cron-reference\.md","exists":true,"bytes":[1-9][0-9]*/'
      - label: system 全文里有「定时任务」段（固定段的标题行）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "===== 定时任务 =====" }
      - label: 段正文真的注入了（禁令句原文——能力告知与禁区的承重句）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "不许用 cli_run 手搓系统级调度" }
      - label: 装配清单的既有来源不受影响（identity 仍在——段是追加，不是替换）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"source":"identity"' }
      - shot: 01-新会话
---

# 212-cron-prompt-section —— 提示词段在场（tasks §8.6）

## 本场景在验什么

交互会话的 system prompt 在 path-reference 之后、AGENTS 三层之前注入一段「定时任务」
（`src-tauri/src/harness/prompts/cron-reference.md`），装配清单 `session_open.assembly`
记一条 `cron_reference`：仓内相对路径、`exists=true`、剔除尾空白后的字节数。本场景在真机上
确认这四件事都在——判据取自会话留存的首行（`session_open`），不是面板文案。

## 为什么需要它

提示词段是模型「知道有 cron 工具、不许手搓系统级调度」的唯一来源；装配清单是「为什么这一轮
模型看得见 / 看不见」的可审计读数。段缺失不会有任何报错，只表现为模型不按纪律行事——那是
抽样观察的事，机器判据只能钉「装配在场」。

## 边界（如实登记）

段的**行为遵从度**（真的用 cron_task_create、不写 LaunchAgent / crontab）不做机器断言：mock
provider 代表不了真实模型的遵从度，这部分归 Alex 抽样。子运行装配**不**注入该段（白名单里
没有调度工具）由单测钉住（`context.rs` 的 `cron_reference_is_injected_for_interactive_only`），
本场景不重复。

## 环境与边界

合成 vault + 隔离 `XDG_CONFIG_HOME`；本场景不发工具调用，mock 只回一条正文。
