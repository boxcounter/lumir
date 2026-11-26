---
id: "726-harness-skill-hybrid-invocation"
item: 726
tier: core
title: Skill 混合调用：显式 refs 确定性注入 + 自动 skill_load 分控 + deny/非法 fail closed + 普通路径与草稿恢复
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-skill-hybrid.json"
    permissions:
      deny: ["skill_load(default)"]
    # 本场景不验证 Web；显式关闭以固定工具面（阶段5回扫）。
    web_access:
      enabled: false
seed:
  registry:
    - { id: acc-hybrid, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-hybrid:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.6
      harnessPane: true
steps:
  - name: 预置 v3 草稿 refs（禁手动/非法项走旧引用复核；不含 acc-deploy，留给真实候选选择）
    do: envWrite
    file: "harness/drafts/acc-hybrid.json"
    content: |
      {"version":3,"text":"/tmp-acc\n/acc-skill-abc\n/acc-background\n/acc-invalid\n/default","caret":61,"cards":[],"skills":[{"name":"tmp-acc","from":0,"to":8},{"name":"acc-skill-abc","from":9,"to":23},{"name":"acc-background","from":24,"to":39},{"name":"acc-invalid","from":40,"to":52},{"name":"default","from":53,"to":61}]}
  - name: 默认 Skill（唯一正文 marker）
    do: vaultWrite
    file: .agents/skills/acc-skill-abc/SKILL.md
    content: |
      ---
      description: 合成默认 Skill
      ---
      ACC-DEFAULT-BODY
  - name: 路径同前缀 Skill
    do: vaultWrite
    file: .agents/skills/tmp-acc/SKILL.md
    content: |
      ---
      description: 合成路径前缀 Skill
      ---
      ACC-TMP-BODY
  - name: 禁自动 Skill
    do: vaultWrite
    file: .agents/skills/acc-deploy/SKILL.md
    content: |
      ---
      description: 合成禁自动 Skill
      disable-model-invocation: true
      ---
      ACC-DEPLOY-BODY
  - name: 禁手动 Skill
    do: vaultWrite
    file: .agents/skills/acc-background/SKILL.md
    content: |
      ---
      description: 合成禁手动 Skill
      user-invocable: false
      ---
      ACC-BACKGROUND-BODY
  - name: 非法调用元数据 Skill
    do: vaultWrite
    file: .agents/skills/acc-invalid/SKILL.md
    content: |
      ---
      description: 合成非法 Skill
      user-invocable: yes
      ---
      ACC-INVALID-BODY
  - name: deny 对照 Skill（发现期 description 仍可解析，执行期两入口均不得注入正文）
    do: vaultWrite
    file: .agents/skills/default/SKILL.md
    content: |
      ---
      description: 合成 deny 对照 Skill
      ---
      ACC-DENY-BODY
  - name: 正常重启以恢复草稿 refs 与策略现场
    do: restart
  - name: 等 harness 与 refs chip 恢复
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/", "tmp-acc", "acc-background"]
    timeoutMs: 40000

  - name: 重启恢复后真实点击 composer，建立首个发送焦点
    do: clickInNode
    target: { role: AXTextArea, name: "tmp-acc" }
    expect:
      - label: 恢复后的 composer 已持焦
        ax: { focused: "AXTextArea" }
  - name: 显式旧 refs 发送（当前策略复核，不重新扫描文本）
    do: key
    key: enter
  - name: 等显式回合完成
    do: waitFor
    waitFor:
      has: ["显式选择回合完成。"]
    expect:
      - label: 默认与路径 Skill 正文进入 input/request
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-DEFAULT-BODY" }
      - label: 路径 Skill 正文进入 input/request
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-TMP-BODY" }
      - label: 禁手动失败进显式痕迹字段（不再是 live-only）
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"lumir_skill_trace":\[[^\]]*"code":"skill_user_invocation_disabled"/' }
      - label: 非法元数据失败进显式痕迹字段
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"lumir_skill_trace":\[[^\]]*"code":"skill_invocation_invalid"/' }
      - label: 两个成功 Skill 各留一条 done 痕迹
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"lumir_skill_trace":\[[^\]]*"name":"tmp-acc","status":"done"/' }
      - label: 路径 Skill 的成功痕迹在场
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"lumir_skill_trace":\[[^\]]*"name":"acc-skill-abc","status":"done"/' }
      - label: 失败原因只活在痕迹字段，不冒充正文 part
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: '/"type":"input_text"[^}]*skill_user_invocation_disabled/' }
      - label: deny 的显式正文未注入
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-DENY-BODY" }
      - label: 禁手动正文未进入显式回合
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-BACKGROUND-BODY" }
      - label: 非法正文未进入显式回合
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-INVALID-BODY" }
      - label: acc-deploy 尚未由其他通道注入
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-DEPLOY-BODY" }
      - label: 显式正文不上屏
        ax: { not: "ACC-TMP-BODY" }

  - name: 展开显式回合工具组，核对五个名字的显式痕迹行
    do: click
    target: { role: AXButton, name: "个工具调用 · 全部完成" }
    expect:
      - label: 两个成功 Skill 各有已加载痕迹行
        ax: { has: "/explicit_skill acc-skill-abc/" }
      - label: 路径 Skill 的成功痕迹行在场
        ax: { has: "/explicit_skill tmp-acc/" }
      - label: 禁手动工具行同时绑定 acc-background 与专用错误
        ax: { has: "/explicit_skill acc-background · error · skill_user_invocation_disabled/" }
      - label: 非法工具行同时绑定 acc-invalid 与专用错误
        ax: { has: "/explicit_skill acc-invalid · error · skill_invocation_invalid/" }
      - label: deny 的显式行绑定 default 与权限错误
        ax: { has: "/explicit_skill default · denied · permission_denied/" }

  - name: 自动入口逐项调用（普通文本，不生成 refs）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|auto" }
    text: "auto"
  - name: 发送自动回合
    do: key
    key: enter
  - name: 等自动策略回合完成
    do: waitFor
    waitFor:
      has: ["自动策略回合完成。"]
    expect:
      - label: 禁自动返回专用错误
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", jsonlOutput: { tool: skill_load, has: { code: skill_model_invocation_disabled } } }
      - label: 禁自动正文未回送
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-DEPLOY-BODY" }
      - label: 禁手动自动入口仍有正文正向对照
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"type":"function_call_output".*ACC-BACKGROUND-BODY/' }
      - label: 非法元数据自动入口 fail closed
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", jsonlOutput: { tool: skill_load, has: { code: skill_invocation_invalid } } }
      - label: 非法正文未回送
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-INVALID-BODY" }
      - label: deny 自动入口回送权限错误且无正文
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", jsonlOutput: { tool: skill_load, has: { code: permission_denied } } }
      - label: deny 正文仍未出现
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", not: "ACC-DENY-BODY" }

  - name: 行首 /tmp（有候选时 Enter 会接受；先 Esc 关闭以发送原文）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/tmp" }
    text: "/tmp"
    expect:
      - label: 路径前缀命中 tmp-acc，候选已出现
        ax: { has: "AXList (Select a Skill)" }
  - name: Esc 关闭候选，保留原文 /tmp
    do: key
    key: escape
    expect:
      - label: 候选已关闭
        ax: { not: "AXList (Select a Skill)" }
      - label: composer 原文未被改写
        ax: { has: '/AXTextArea = "/tmp"/' }
  - name: Enter 发送普通路径原文（未被候选消费）
    do: key
    key: enter
  - name: 等普通路径回合完成
    do: waitFor
    waitFor:
      has: ["普通路径回合完成。"]
    expect:
      - label: /tmp 用户消息只有带编辑器上下文的原文 part，没有任何 Skill ref
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/^.*"kind":"llm_request".*"content":\[{"text":"/tmp\\n\\n\[当前编辑器上下文：\\n文件：harness-note.md\\n视口（第 1-6 行）\]","type":"input_text"}\],"role":"user".*$/' }

  - name: 键入 /acc-d 并 ↓ 进入选择态（保留下方向键与 Enter 的真实候选选择）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|/acc-d" }
    text: "/acc-d"
  - name: 选择 acc-deploy
    do: key
    key: down
  - name: 确认候选
    do: key
    key: enter
  - name: 发送真实候选 ref
    do: key
    key: enter
  - name: 等候选选择回合完成
    do: waitFor
    waitFor:
      has: ["候选选择回合完成。"]
    expect:
      - label: 禁自动 Skill 仍可经真实候选显式注入
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-DEPLOY-BODY" }
      - label: 候选用户消息含原文 part、acc-deploy part 与显式痕迹字段
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/^.*"kind":"llm_request".*"content":\[{"text":"/acc-deploy \\n\\n\[当前编辑器上下文：\\n文件：harness-note.md\\n视口（第 1-6 行）\]","type":"input_text"},{"lumir_skill":"acc-deploy","text":"\[已加载 Skill：acc-deploy\]\\n---\\ndescription: 合成禁自动 Skill\\ndisable-model-invocation: true\\n---\\nACC-DEPLOY-BODY\\n","type":"input_text"}\],"lumir_skill_trace":\[[^\]]*\],"role":"user".*$/' }
      - label: 显式正文仍不上屏
        ax: { not: "ACC-DEPLOY-BODY" }

  - name: 记录含显式/自动历史的留存
    do: record
    file: "env:harness/sessions/acc-hybrid/*.jsonl"
    as: hybrid-history
  - name: 策略后来变更只影响新调用，旧显式/自动历史不回写
    do: vaultWrite
    file: .agents/skills/acc-skill-abc/SKILL.md
    content: |
      ---
      description: 合成默认 Skill（后改禁自动）
      disable-model-invocation: true
      ---
      ACC-DEFAULT-BODY
    expect:
      - label: 旧留存逐字节不变
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", unchangedSince: hybrid-history }
      - label: 旧自动工具结果仍在历史
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-BACKGROUND-BODY" }
      - label: 旧显式正文仍在历史
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-TMP-BODY" }

  - name: 策略变更后聚焦 composer，准备原会话的新自动调用
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 策略变更后发起新的自动调用
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|auto2" }
    text: "auto2"
  - name: 发送新自动调用
    do: key
    key: enter
  - name: 等新策略调用完成
    do: waitFor
    waitFor:
      has: ["策略变更新调用完成。"]
    timeoutMs: 20000
    expect:
      - label: 新自动调用按当前禁自动策略拒绝（唯一错误绑定 acc-skill-abc，排除前序 acc-deploy）
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", jsonlOutput: { tool: skill_load, has: { code: skill_model_invocation_disabled, message: "技能 acc-skill-abc 只允许用户显式选择" } } }
      - label: 旧显式与自动正文仍不被策略回写
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-TMP-BODY" }
      - label: 旧自动工具结果仍保留
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-BACKGROUND-BODY" }

  - name: 开始新会话，确保恢复目标不是当前会话（当前会话恢复是 no-op，不重建面板）
    do: click
    target: { role: AXButton, name: "新会话" }
  - name: 等新会话面板清空
    do: waitFor
    waitFor:
      has: ["问点什么"]
      not: ["/acc-skill-abc"]
    timeoutMs: 10000
  - name: 打开历史会话清单并真正恢复含显式 part + 自动工具结果的会话
    do: click
    target: { role: AXPopUpButton, nth: 0 }
  - name: 等含本轮引用的历史会话行出现
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(/tmp-acc/"]
    timeoutMs: 15000
    expect:
      - label: 恢复目标是本轮 /tmp-acc 会话而不是无名序号项
        node: { role: AXMenuItem, name: "/tmp-acc", present: true }
      - shot: 03-恢复会话清单
  - name: 恢复该会话（AXPress；坐标点击依赖前台，会被别的窗口吃掉）
    do: click
    target: { role: AXMenuItem, name: "/tmp-acc", nth: 0 }
    expect:
      - label: 点击落在恢复行上（会话浮层已收起）
        ax: { not: "AXMenuItem (/tmp-acc" }
  - name: 等恢复内容重建（恢复会话本身不发起模型回合）
    do: waitFor
    waitFor:
      has: ["当前编辑器上下文："]
    timeoutMs: 15000
  - name: 恢复后展开显式回合工具组，核对痕迹仍在且不重复
    do: click
    target: { role: AXButton, name: "5 个工具调用 · 全部完成" }
    expect:
      - label: 恢复后的成功行仍在
        ax: { has: "/explicit_skill acc-skill-abc/" }
      - label: 恢复后的路径 Skill 成功行仍在
        ax: { has: "/explicit_skill tmp-acc/" }
      - label: 恢复后的禁手动失败行仍带原因
        ax: { has: "/explicit_skill acc-background · error · skill_user_invocation_disabled/" }
      - label: 恢复后的权限拒绝行仍带原因
        ax: { has: "/explicit_skill default · denied · permission_denied/" }
      - label: 恢复后的痕迹行不含正文
        ax: { not: "ACC-TMP-BODY" }
  - name: 恢复后真实点击 composer，准备产生恢复后的首个新请求
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入恢复后的新提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|resume" }
    text: "resume"
  - name: 发送恢复后的新回合
    do: key
    key: enter
  - name: 等恢复后的新 session 收到响应（新会话 mock 游标从 0 开始，不借用源会话脚本位置）
    do: waitForFile
    waitForFile:
      path: "env:harness/sessions/acc-hybrid/*.jsonl"
      has: '"kind":"llm_response"'
    timeoutMs: 20000
    expect:
      - label: 恢复产生新会话且此刻只有恢复这一条请求，旧文件不得冒充证据
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - label: 恢复产生的请求含旧显式正文
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-TMP-BODY" }
      - label: 恢复产生的请求含旧自动工具结果
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "ACC-BACKGROUND-BODY" }
      - label: 恢复面板不显示显式正文
        ax: { not: "ACC-TMP-BODY" }
      - label: 恢复面板也不显示自动工具正文
        ax: { not: "ACC-BACKGROUND-BODY" }
---

本场景只证明 mock 链路下的注入、留存、投影、策略执行和发送行为，不证明真实模型会遵守索引提示。
发现期按现状读取 SKILL.md 解析 description 与策略；负向判据只约束对应执行期输出面，不声称发现期零 IO。
显式 Skill 的可见痕迹由会话留存里的 `lumir_skill_trace` 字段承载：成功与失败各一条工具名
`explicit_skill` 的痕迹行，失败原因只在该字段与工具行上、不进正文 part；恢复路径从同一字段重建。
provider wire 层面的剥离（`lumir_skill` / `lumir_skill_trace` 均不出现）由 Rust 单测覆盖，本场景不做
wire 层断言。
既有场景 77 是默认自动能力回归基线，文件与 fixture 均不由本场景修改；执行批次应连同 77 一起跑。
