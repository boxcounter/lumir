---
id: "206-subagent-notice-restore"
item: "8.23"
tier: full
title: 子代理 8.23 已投递未消费的通知：合并窗口内退出 ⇒ 重启重建上屏、不补唤醒；消费后不重复
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$env/subagent-fixtures/notice.json"
seed:
  # 模板在起 app 之前预置（M745，口径与 189 同条）：本场景的模板无 `${run_id}`，
  # 运行期的第二份 envWrite（重启后再投递一段）照旧改写这份副本。
  envFiles:
    - path: subagent-fixtures/notice.json
      from: "$fixtures/subagent-fixtures/notice.json"
steps:
  - name: 写入定义
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 通知恢复样本
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

  - name: 等后台启动（父回合收尾，通知在 2s 合并窗口内尚未上屏）
    do: waitFor
    waitFor:
      has: ["SGU-PARENT 父会话：后台已启动。"]
    timeoutMs: 30000

  - name: 等后台 run 收敛（投递标记在收敛时写；留一拍确保 marker 落盘）
    do: sleep
    ms: 1000

  - name: 合并窗口内退出（投递标记已写、通知尚未上屏）
    do: restart

  - name: 重启后确认 pane 在场（重启会恢复上次的面板布局；不再 ⌘⇧A，否则会把恢复出的面板关掉）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 40000

  - name: 等 pane 就绪
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 30000

  - name: 打开会话浮层并恢复历史会话
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等历史会话行
    do: waitFor
    waitFor:
      has: ["SUBQ"]
    timeoutMs: 15000
  - name: 恢复历史会话
    do: clickInNode
    target: { name: "SUBQ" }

  - name: 等重建的通知上屏
    do: waitFor
    waitFor:
      has: ["后台任务完成"]
    timeoutMs: 30000
    expect:
      - label: 通知据投递标记 + subrun sidecar 重建并上屏（恰好一条，不重复）
        ax: { count: { pattern: "后台任务完成", exact: 1 } }
      - label: 重建不触发自动回合（没有 assistants 汇报 —— fixture 里也没有 auto 条目可弹）
        ax: { not: "SGU-AUTO" }
      - label: 新会话文件复制了投递标记
        file: { path: "env:harness/sessions/*/*.jsonl", has: "notice_delivered" }
      - shot: 01-重建的通知

  # ── 反向验证：消费之后标记陈旧、不重复上屏 ────────────────────────────────
  - name: 换一份「用户发言」的脚本（避免再起后台任务）
    do: envWrite
    file: "subagent-fixtures/notice.json"
    content: |
      {"version": 1, "subrun_span": 1, "responses": [{"text": "SWN-AFTER 用户发言后的回答。"}]}

  - name: 用户发言（通知随此次请求进入模型上下文）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ2" }
    text: "SUBQ2"
  - name: 发送
    do: key
    key: enter

  - name: 等用户回合完成
    do: waitFor
    waitFor:
      has: ["SWN-AFTER 用户发言后的回答。"]
    timeoutMs: 30000
    expect:
      - label: 通知已进入请求（auto_notice 标记在 llm_request.messages 里）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "auto_notice" }

  - name: 再次重启
    do: restart

  - name: 确认 pane 在场（重启恢复面板布局；不再 ⌘⇧A）
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 40000
  - name: 等 pane 就绪
    do: waitFor
    waitFor:
      has: ['/AXButton \(发送\)/']
    timeoutMs: 30000
  - name: 打开会话浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等历史会话行
    do: waitFor
    waitFor:
      has: ["SUBQ"]
    timeoutMs: 15000
  - name: 恢复历史会话
    do: clickInNode
    target: { name: "SUBQ" }
  - name: 等恢复完成（用户发言的回复上屏）
    do: waitFor
    waitFor:
      has: ["SWN-AFTER 用户发言后的回答。"]
    timeoutMs: 30000
    expect:
      - label: 已消费 ⇒ 投递标记陈旧、通知不重复上屏
        ax: { count: { pattern: "后台任务完成", exact: 0 } }
      - shot: 02-不重复上屏
---

# 206 —— 8.23 已投递未消费的通知恢复

后台 run 收敛时投递标记已写（早于上屏）；在空闲合并窗口（2s）内退出进程 ⇒ 通知只存在于
标记 + `subrun` sidecar 里。重启并恢复会话：通知据标记重建、恰好上屏一次，**不补唤醒**。

反向验证：用户发言让通知进入 `llm_request.messages`（被消费）后再重启恢复 —— 标记判陈旧，
通知不重复上屏（count = 0）。

已知边界：窗口内退出由「父回合收尾后立即 restart」保证；若机器慢到 2s 窗口先到期，通知会先
上屏（仍由标记 + 恢复路径兜住，但本场景的「未上屏」前提不再成立，可能判红——如实暴露）。
