---
id: "105-harness-wire-retention"
item: 105
title: wire 留存：一轮含工具循环的对话后，sessions/<id>.jsonl 首行装配记录（含来源存在与否）+ 每轮完整 llm_request / llm_response（思考文本 + usage）
open: harness-note.md
marker: "HNL-ALPHA"
# fixture = 两轮脚本（思考 ALPHA + 正文 TTO-ORD1 + vault_read 调用 → 思考 BETA + 正文 TTO-ORD2），
# 恰好造出「一轮含工具循环」：迭代 1 落 llm_request/llm_response，工具执行后迭代 2 再各落一条，
# 且两条响应都带 reasoning_chunks（思考展示文本）与 usage。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking-tool-order.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["w", "i", "r", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等工具循环跑完（TTO-ORD1 → vault_read → TTO-ORD2）
    do: waitFor
    waitFor:
      has: ["TTO-ORD2-答案在第二段思考之前。"]
    timeoutMs: 30000
    expect:
      - label: 最终回答渲染（回合真的跑完）
        ax: { has: "TTO-ORD2-答案在第二段思考之前。" }
      - label: 留存文件首行是 session_open（wire 留存的会话入口）
        file: { path: "env:harness/sessions/*.jsonl", has: '"kind":"session_open"' }
      - label: 首行为装配记录（payload 以 assembly 开头，session_open 由首条记录一并写盘）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^\{"payload":\{"assembly":/' }
      - label: session_open 带 opened_from=new 与 provider 身份
        file: { path: "env:harness/sessions/*.jsonl", has: '"opened_from":"new","provider":"mock"' }
      - label: session_open 带完整 system prompt 全文（装配结果落盘）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"session_open".*"system":".+".*$/' }
      - label: 装配清单的固定段在场（存在来源的 path 为 null）
        file: { path: "env:harness/sessions/*.jsonl", has: '"exists":true,"path":null,"source":"identity"' }
      - label: 装配清单记录「来源当时不存在」（vault 根无 AGENTS.md，exists:false 同样在场）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"exists":false,"path":"[^"]*AGENTS\.md","source":"agents_vault_root".*$/' }
      - label: 本地覆盖层同理（vault 根无 AGENTS.local.md，exists:false 同样在场）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"exists":false,"path":"[^"]*AGENTS\.local\.md","source":"agents_vault_root_local".*$/' }
      - label: 每次迭代落完整 llm_request（迭代 2 的历史里带上一轮的工具调用与结果）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_request".*"type":"function_call".*"type":"function_call_output".*$/' }
      - label: llm_request 的请求体齐备（messages + params + provider + system）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_request".*"request":\{"messages":\[.*"params":\{"thinking":"[a-z]+"\}.*"provider":"mock".*"system":".+".*$/' }
      - label: llm_response 带思考展示文本（迭代 1）
        file: { path: "env:harness/sessions/*.jsonl", has: '"thinking":"TTO-THINK-ALPHA 先读文件。"' }
      - label: llm_response 带思考展示文本（迭代 2）
        file: { path: "env:harness/sessions/*.jsonl", has: '"thinking":"TTO-THINK-BETA 读完再答。"' }
      - label: llm_response 带 usage（迭代 1）
        file: { path: "env:harness/sessions/*.jsonl", has: '"usage":{"cached_tokens":300,"input_tokens":900,"output_tokens":20}' }
      - label: llm_response 带 usage（迭代 2）
        file: { path: "env:harness/sessions/*.jsonl", has: '"usage":{"cached_tokens":1000,"input_tokens":1400,"output_tokens":25}' }
      - shot: 01-工具循环完成
---

# 105-harness-wire-retention —— wire 形态会话留存（change reshape-harness-session-recording 3.6）

## 本场景在验什么

留存从「业务事件流水」重塑为 **wire/input 形态**（spec「会话本地留存」MODIFIED）：每会话一个
append-only JSONL（`<隔离配置>/harness/sessions/<session_id>.jsonl`），首行 `session_open`
落**完整装配记录**——system prompt 全文、每个来源的路径与**存在与否**、provider / 模型 / 思考档位；
其后每次发给模型的请求落 `llm_request`（完整请求体），响应落 `llm_response`（正文 / 思考展示文本 /
工具调用 / usage）。被 wire 覆盖的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` /
`tool_result` / `usage` / `tool_denied` / …）不再记录。

本场景用一份「思考 + 正文 + 工具调用」的两轮 fixture，跑完一轮含工具循环的对话后，逐条断言
`sessions/*.jsonl` 的留存形状。断言基准是 change 的 specs delta（scenario「留存落盘」「装配记录
落盘」「思考落盘与回放」）与 design §2 的 schema。

## 断言口径

- **首行 session_open**：`/^\{"payload":\{"assembly":/`——envelope 的 `payload` 键序是 serde_json 的
  字典序（`assembly` 是 session_open 的字典序首键），因此这一行以该前缀开头即证明它是装配记录那一条。
  **「首行」这条不变量本身**（`JsonlWriter` 的挂起行保证）由 Rust 单测
  `jsonl.rs::first_line_is_always_session_open_and_pending_update_works` 钉住——本套件的 DSL 没有
  「取文件第 N 行」的判据，这里只断言该记录在场且形状正确。
- **来源存在与否**：`agents_vault_root` 与 `agents_vault_root_local` 的 `exists:false`——合成
  vault 根既没有 `AGENTS.md` 也没有 `AGENTS.local.md`（第三层，change `harness-agents-local-md`），
  这条「来源当时不存在」是旧实现静默跳过的装配事实（design §2）；固定段（identity / quote_reference）
  `path:null, exists:true`。存在态（`exists:true` + 顺序与覆盖声明）由场景 123 覆盖——它自带两份
  合成 AGENTS 文件。**不断言 user-wide AGENTS.md**：它的路径含真实用户名，且各机可能不存在
  （信息卫生纪律，REVIEW.md 第 17 条）。
- **每次迭代落完整 llm_request**：迭代 2 的请求历史里带迭代 1 的工具 `function_call` 与
  `function_call_output`——只有「工具循环每轮各落一条 llm_request」才成立。请求体字段齐备用一条
  整行正则判（messages / params / provider / system 同时在场，字典序：messages → model → params →
  provider → system）。
- **思考与 usage 落 llm_response**：`thinking`（展示文本，来自 fixture 的 `reasoning_chunks`）与
  `usage`（`cached_tokens` < `input_tokens` < `output_tokens` 的字典序）逐条在场。
- **键序说明**：本仓 `serde_json` 未启用 `preserve_order`，对象键按字典序序列化——所有多键断言
  都按字典序写（既有旧断言 `"decision":"allow","id":…,"kind":…,"name":…` 即此口径）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；vault_read 只读
  `harness-note.md`，不写任何 vault 文件。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
