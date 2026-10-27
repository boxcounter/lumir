---
id: "165-harness-auto-title-legacy-fallback"
item: 165
tier: full
title: 会话自动命名③：无标题记录的旧会话文件安静回落首条用户消息（不告警、不改写）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  # 注册表 id 是**场景的判据**：会话目录名取注册表 id，因此这里能预置一份新布局的旧会话文件
  # （产品自生成的 `vault-<pid>-<n>` 场景侧预知不到——与场景 124 同一做法）。
  registry:
    - { id: acc-title, path: $vault, lastOpenedAt: 1757000002000 }
  # 本 change 之前的会话文件：session_open + 一条问答，**没有 session_title 记录**。
  harnessSessions:
    - vaultId: acc-title
      name: s1759912300000-leg001.jsonl
      firstUserText: legacyquietnote
steps:
  - name: 记录旧会话文件的基线（后续判「文件逐字节未变 / mtime 未推进」）
    do: record
    file: "env:harness/sessions/acc-title/s1759912300000-leg001.jsonl"
    as: legacySeed

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }
      - label: 当前还没有活跃会话（会话名钮显示「新会话」）
        ax: { has: "/AXPopUpButton \\(新会话/" }

  - name: 打开会话浮层（历史会话列表现拉现建）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等旧会话行出现（名字 = 首条用户消息截断；没有标题记录）
    do: waitFor
    waitFor:
      has: ["legacyquietnote"]
    timeoutMs: 15000
    expect:
      - label: 行名回落该会话首条用户消息（无 title 记录 ⇒ 安静回落，不显示「新会话」）
        ax: { has: "legacyquietnote" }
      - label: 浮层真实渲染（O1/O2 两段）
        geom:
          target: { name: "legacyquietnote" }
          minWidth: 120
          minHeight: 16
          painted: { min: 60 }
      - shot: 01-旧文件回落行名

  - name: 点该行恢复（行内是 menuitem 嵌 div 壳——走坐标注入，M406 起 clickInNode）
    do: clickInNode
    target: { name: "legacyquietnote" }

  - name: 等恢复完成（标题栏会话名落到回落口径）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(legacyquietnote/"]
    timeoutMs: 15000
    expect:
      - label: 恢复后会话名 = 首条用户消息截断（不是标题、不是「新会话」）
        ax: { has: "/AXPopUpButton \\(legacyquietnote/" }
      - label: 源会话文件未被回填标题记录（不迁移、不告警、不改写既有文件）
        file:
          path: "env:harness/sessions/acc-title/s1759912300000-leg001.jsonl"
          not: '"kind":"session_title"'
      - label: 源会话文件内容逐字节未变（append-only 纪律：旧文件不再追加）
        file:
          path: "env:harness/sessions/acc-title/s1759912300000-leg001.jsonl"
          unchangedSince: legacySeed
      - label: 源会话文件 mtime 未推进（「写了同一份内容」也判红）
        file:
          path: "env:harness/sessions/acc-title/s1759912300000-leg001.jsonl"
          mtimeUnchangedSince: legacySeed
      - shot: 02-恢复后回落名
---

# 165-harness-auto-title-legacy-fallback —— 旧文件安静回落（change add-session-auto-naming 5.3③）

## 本场景在验什么

本 change 之前的会话文件没有 `session_title` 记录：列举、恢复、展示一律**安静回落**到首条
用户消息口径——不告警、不写回填记录、不改写任何既有文件（append-only + ADR 0003 的
「不改写既有文件」纪律）。

## 预置现场

`seed.harnessSessions` 写一份新布局的会话留存
（`env/harness/sessions/acc-title/s1759912300000-leg001.jsonl`）：`session_open` + 一条
`llm_request` + 对应 `llm_response`，**没有** `session_title`。目录名取预置注册表 id
`acc-title`——产品自生成的 id 形如 `vault-<pid>-<n>`，场景侧无从预知（与场景 124 同一做法）。
`session_open.vault_root` 走 `$vault` 记号（/tmp 路径）：归属判据是逐字比较，这条现场刻意保留。

## 断言口径

- **回落可判**：行名/标题栏若要判「是不是回落」，就不能和标题串混淆——首条用户消息是
  场景独有的合成串 `legacyquietnote`（15 字符，不会被 20 字截断改写）。
- **不改写**：`record` 先记 sha256 与 mtime 基线，恢复后 `unchangedSince` + `mtimeUnchangedSince`
  **成对**断言（README 的「不落盘」条：sha256 相同只说明内容没变，还可能「写了同一份内容」；
  两条一起才判到「完全没写」）。再叠一条 `not: '"kind":"session_title"'` 判「没有回填标题」。
- **不告警**：用户面没有错误 toast 是本场景的隐含前提；产品侧警告走配置面板，不在本判据内——
  真实可判的是「文件没被改 + 界面没显示错误」（后者由本场景不出现错误行间接保证，见边界）。

## 已知边界

- **不告警的严格判据不在本场景**：产品没有把「旧文件无标题」作为任何 UI 提示的通道（设计上
  就不告警），所以这里只能判「文件未变 + 展示回落」，判不了「stderr 没有一行 warning」。
  该面的实现判据在 Rust 单测（`harness::jsonl::tests::effective_title_last_wins` 的
  「无记录 ⇒ None」与恢复测试的「不写 inherit」）。
- 恢复后的后续命名不在本场景：恢复出的会话没有标题，下一轮正常完成会走初始生成（单测覆盖）。
