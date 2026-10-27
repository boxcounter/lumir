---
id: "193-subagent-model-resolution"
item: "8.11"
tier: full
title: 子代理 8.11 模型解析：调用覆盖生效
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-model.json"
steps:
  - name: 写入定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 模型覆盖样本
      ---
      

  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ"
  - name: 发送
    do: key
    key: enter

  - name: 等回合完成
    do: waitFor
    waitFor:
      has: ["SGF-MODEL-PARENT 父会话：完成。"]
    timeoutMs: 30000
    expect:
      - label: 覆盖值也进了该段 sidecar（留存与 live 同源）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"kind":"subrun".*"model":"mock-strong"/' }
      - shot: 01-模型覆盖

  - name: 等诊断日志落盘（日志写线程按批次刷盘，留一拍再读）
    do: sleep
    ms: 1200
    expect:
      - label: 调用级 model 覆盖生效（定义是 inherit，事件里的实际模型是覆盖值）
        file: { path: "env:logs/*.jsonl", has: '/"event":"subagent_started".*"model":"mock-strong"/' }

---

# 193 —— 8.11 模型解析

调用参数 `model` 覆盖定义（定义未写 model = inherit）⇒ 实际运行模型是覆盖值。
判据取 `subagent_started.model` 与 subrun sidecar 的 `model`（两处同源）。

已知边界（mock provider 的模型清单是开放的——`resolve_model` 对 mock 恒判「已声明」）：
「定义写非法 model 回落 inherit + warning」与「调用非法 model 被拒」两条只在真 provider 的
声明清单下可达，归单测 `model_override_resolves_declared_models_only` 与 `resolve_model` 的
用例；本场景在 mock 层只判「覆盖真的生效」。