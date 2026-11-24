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
      - label: 禁手动旧 ref 不注入并给专用错误
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "skill_user_invocation_disabled" }
      - label: 非法旧 ref 不注入并给专用错误
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: "skill_invocation_invalid" }
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

  - name: 自动入口逐项调用（普通文本，不生成 refs）
    do: keys
    keys: ["a", "u", "t", "o"]
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

  - name: 行首普通 /tmp（候选可出现但被动态 Enter 不选）
    do: keys
    keys: ["/", "t", "m", "p"]
  - name: 直接 Enter 发送普通路径
    do: key
    key: enter
  - name: 等普通路径回合完成
    do: waitFor
    waitFor:
      has: ["普通路径回合完成。"]
    expect:
      - label: /tmp 用户消息只有原文，没有 lumir_skill part
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/"role":"user","content":\[\{"type":"input_text","text":"/tmp"\}\]/' }

  - name: 键入 /acc-d 并 ↓ 进入选择态（无 e 字符，避开已知按键丢弃族）
    do: keys
    keys: ["/", "a", "c", "c", "-", "d"]
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
      - label: 显式段头与本地标记进入留存
        file: { path: "env:harness/sessions/acc-hybrid/*.jsonl", has: '/\[已加载 Skill：acc-deploy\].*"lumir_skill":"acc-deploy"/' }
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
---

本场景只证明 mock 链路下的注入、留存、投影、策略执行和发送行为，不证明真实模型会遵守索引提示。
发现期按现状读取 SKILL.md 解析 description 与策略；负向判据只约束对应执行期输出面，不声称发现期零 IO。
既有场景 77 是默认自动能力回归基线，文件与 fixture 均不由本场景修改；执行批次应连同 77 一起跑。
