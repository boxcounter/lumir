---
id: "257-harness-request-tool-names"
item: 257
tier: full
title: 请求暴露面可核对：llm_request.tool_names 启用态含 task、子运行白名单 task 恒缺席
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-subagent-delegate.json"
steps:
  - name: 写入子代理定义 .lumir/agents/research.md
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 调研 vault 里的规范变更并给结论
      tools: [vault_read, vault_search]
      ---
      你是只读调研子代理。只做探索与综合，不修改文件。
      

  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|SUBQ" }
    text: "SUBQ 梳理这周的规范变更"
  - name: 发送
    do: key
    key: enter

  - name: 等父会话收到子代理摘要并续写
    do: waitFor
    waitFor:
      has: ["SGA-PARENT-ONE 父会话总结：research 已梳理完 9 个变更。"]
    timeoutMs: 30000
    expect:
      - label: 父会话最终回答上屏（执行链走完，暴露面断言才有对象）
        ax: { has: "SGA-PARENT-ONE" }

  - name: 等父会话留存的暴露面落盘（同一写入点：发送前落盘）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/*/*.jsonl"
      has: '/"tool_names":\[[^\]]*"task"/'
    timeoutMs: 20000

  - name: 父会话留存：暴露面按实际请求记录、只名字、不在响应侧
    expect:
      - label: 每条会话请求都带 tool_names（恒在场；键缺失 = 没有记录，不是空数组）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"tool_names":[' }
      - label: 启用态下 tool_names 含 task（按暴露清单判定，不是靠 tool_calls 反推）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"tool_names":\[[^\]]*"task"/' }
      - label: 只记名字——数组元素是纯字符串，无 schema / 描述 / 参数对象
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/"tool_names":\[("[^"]*"(,"[^"]*")*)?\]/' }
      - label: 暴露面只在请求侧（llm_response 行不带 tool_names，无第二份真源）
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '/"kind":"llm_response".*"tool_names"/', exact: 0 } }

  - name: 子运行审计流水：暴露面是定义白名单，task 恒缺席
    expect:
      - label: 子运行审计里同样带 tool_names（同一写入点，无需另写逻辑）
        file: { path: "env:harness/subruns/*/*.jsonl", has: '"tool_names":[' }
      - label: 子运行按定义白名单暴露（声明了 vault_search）
        file: { path: "env:harness/subruns/*/*.jsonl", has: '/"tool_names":\[[^\]]*"vault_search"/' }
      - label: 深度 1 层不暴露 task（tool_names 里 task 恒缺席）
        file: { path: "env:harness/subruns/*/*.jsonl", count: { pattern: '/"tool_names":\[[^\]]*"task"/', exact: 0 } }
      - shot: 01-暴露面
---

# 257 —— 请求暴露面（llm_request.tool_names）

mock 父响应按 fixture 直接派 research（与 180 同一条执行链，判据不同）：本场景守的是
**暴露面留存**，不是模型的选择行为。`llm_request.tool_names` 按请求里工具定义的顺序只记名字、
恒在场；`[]` 表示「这一请求不带工具」，键缺失表示「没有记录」（本 change 之前的旧文件）——
两者 MUST NOT 混同。

断言分工（与 194 配对形成区分度）：

- 启用态（本场景）：父会话的 `tool_names` 含 `task`；同一会话的子运行审计里 `task` 恒缺席
  （深度 1 层从「靠代码保证」变成「留存上可查」）。
- 关停态（194）：同一字段不含 `task`，且 `tool_names` 键仍在场（负向断言不在「键缺失」上恒绿）。

**字符类写法（别再回到旧口径）**：数组内匹配一律写 `[^\]]*`，不能写 `[^]]*`——后者在 JS 里
被解析成「任意字符 + 字面 `]`」，正向恒不命中、负向恒绿。2026-10-30 实测：`[^]]*` 的
`waitForFile` 轮询 41 次全 false，而同一份留存里 `"tool_names":[…"task"…]` 确实在场
（REVIEW.md「断言等价于子串」条）。

`tool_names` 不含 `task` 时，「没有 task 调用」不是模型的决定（未暴露）；含 `task` 而无
`task` 调用时才是「已暴露、模型没选」。真实 provider 下模型是否主动选择属六格验收，不在本场景。
