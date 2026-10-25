---
id: "238-escape-overlay-close"
item: 238
title: Escape 只收最上层浮层且永不退出应用（change fix-escape-overlay-close-oct24）：权限浮层重建失焦后按 Esc、修饰键准入、焦点回还
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 基线：记录编辑器正文与磁盘文件（Esc 前后的逐字节判据）
    do: recordEditor
    as: beforeEsc
    expect:
      - label: 编辑器正文可读（读不到时 recordEditor 自己会红）
        editor: { has: "HNL-ALPHA" }
  - name: 基线：磁盘上这份文档的 sha256/mtime
    do: record
    file: harness-note.md
    as: doc
    expect:
      - label: 磁盘基线已记下
        file: { path: harness-note.md, exists: true }

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 权限 chip 在位且为出厂档（D426 读屏名取当前档全名）
        ax: { has: "权限模式：保险库写入（点击切换）" }

  - name: 抢前台（后台注入键盘整批丢键会显著加剧——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 点权限 chip 展开浮层
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 三档全名都在浮层里（只读 / 保险库写入 / 完全访问）
        ax: { has: "完全访问" }
      - label: 只读档释义在场（D430——浮层开着的判别串之一，chip 自身只带当前档）
        ax: { has: "读自动放行；写操作都先问你" }

  - name: 点「完全访问」（**真实鼠标点击**：AXPress 不移动 DOM 焦点，只有真点击才把焦点落到这一项上——
      缺陷的成因正是「持焦件被重建摘除」，用 AXPress 驱动时焦点一直在 composer 上、整条路径不会发生）
    do: clickInNode
    target: { role: AXMenuItem, any: "完全访问" }
    dy: 0.5
    expect:
      - label: 点击落在浮层项内且菜单仍开（真点击没有触发「浮层外点击收起」）
        ax: { has: "读自动放行；写操作都先问你" }

  - name: 等 chip 读数翻成完全访问档（选择先行、写回随后）
    do: waitFor
    waitFor:
      has: ["权限模式：完全访问（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 浮层不自动关（选定不自动关——M373 口径；这是本场景「收一个开着的浮层」的前提）
        ax: { has: "读自动放行；写操作都先问你" }
      - label: 写回落盘——config.json 的 harness.permission_mode 已是 full_access
        file: { path: "env:config.json", has: "\"permission_mode\": \"full_access\"" }
      - label: 重建后浮层项仍在场（完全访问项与它的释义都在）
        ax: { has: "全自动；仅危险命令仍问你" }
      - shot: 01-选中后浮层仍开

  - name: 按 Escape（缺陷现场：浮层里点过一档后按 Esc，整个 Lumir 进程退出）
    do: key
    key: escape

  - name: 等 Esc 之后的界面落定（收层 / 回焦都是同步的；留一拍让潜在的退出提示可观测）
    do: sleep
    ms: 1500
    expect:
      - label: 应用仍在（pane 未被连带收起：发送钮在场）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 应用仍在（控制行还在：权限 chip 读数为完全访问档，与 Esc 前一致）
        ax: { has: "权限模式：完全访问（点击切换）" }
      - label: 浮层已收（只读档释义离场 = 浮层不再暴露）
        ax: { not: "读自动放行；写操作都先问你" }
      - label: composer 仍在位（面板没有被误收，后续注入有落点）
        ax: { has: "问点什么" }
      - label: 焦点回到权限 chip（触发元素；不是 body、不是 composer）
        ax: { focused: "AXPopUpButton" }
      - label: 文档正文逐字节不变（Esc 不改文档）
        editor: { unchangedSince: beforeEsc }
      - label: 磁盘文件未被改写（sha256 与 mtime 双判据）
        file: { path: harness-note.md, unchangedSince: doc, mtimeUnchangedSince: doc }
      - label: 权限档写回未被 Esc 回滚（config.json 仍是 full_access）
        file: { path: "env:config.json", has: "\"permission_mode\": \"full_access\"" }
      - shot: 03-Esc之后-应用仍在浮层已收

  - name: 重开浮层（第二段：验证重建后的焦点落点与就地准入）
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 浮层重新展开（只读档释义词重新在场）
        ax: { has: "读自动放行；写操作都先问你" }
  - name: 选「保险库写入」（真实鼠标点击 → 触发第二次重建；焦点在重建前确实落在这一项上）
    do: clickInNode
    target: { role: AXMenuItem, any: "保险库写入" }
    dy: 0.5
  - name: 等读数翻回保险库写入档
    do: waitFor
    waitFor:
      has: ["权限模式：保险库写入（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 重建后焦点回到被选中的同一语义项上（不是 body、不是 composer）
        ax: { focused: "/AX(MenuItem|MenuItemRadio|RadioButton|Button)/" }
      - label: 焦点不在 composer 上（重建没有把焦点挪到别处）
        ax: { not: "/AXTextArea[^\\n]*\\(focused\\)/" }
      - label: 写回同样落盘（第二次写回不是空转）
        file: { path: "env:config.json", has: "\"permission_mode\": \"vault_write\"" }
      - shot: 04-第二次重建后焦点

  - name: 带修饰键的 Escape（⇧Escape）——就地处理器与兜底共用同一份准入，只消费默认行为、不关层
    do: keys
    keys: ["shift+escape"]
    expect:
      - label: 浮层保持打开（⇧Escape 不算关闭意图）
        ax: { has: "读自动放行；写操作都先问你" }
      - label: 应用仍在（pane 未被收起）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 焦点不动（仍恰有一个 focused 的浮层项）
        ax: { focused: "/AX(MenuItem|MenuItemRadio|RadioButton|Button)/" }
      - shot: 05-⇧Escape不关层

  - name: 随后按无修饰的 Escape——这一拍才收浮层
    do: key
    key: escape

  - name: 等收层与回焦落定
    do: sleep
    ms: 1200
    expect:
      - label: 浮层已收（只读档释义离场）
        ax: { not: "读自动放行；写操作都先问你" }
      - label: 应用仍在（发送钮在场）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 焦点回到权限 chip
        ax: { focused: "AXPopUpButton" }
      - label: 文档正文仍逐字节不变
        editor: { unchangedSince: beforeEsc }
      - label: 磁盘文件仍未被改写
        file: { path: harness-note.md, unchangedSince: doc, mtimeUnchangedSince: doc }
      - shot: 06-裸Escape收浮层
---

# 238-escape-overlay-close —— Escape 只关最上层浮层、永不退出应用

## 本场景在验什么

change `fix-escape-overlay-close-oct24` 的核心合同（`keymap-commands` 的「Escape 的顶层关闭语义与
窗口隔离」条 + `harness` 的「浮层可访问性」条），逐条对应设计 §5.2 / §5.3 的真机层判据：

| 段 | 用户路径 | 期望 |
|---|---|---|
| A | ⌘⇧A 开 pane → 权限 chip 展开浮层 → 点「完全访问」（浮层按新档重建、焦点落回选中项）→ 按 `Esc` | 只收浮层、焦点回权限 chip、面板与窗口仍在、Lumir 不退出、文档与磁盘逐字节不变、配置档位不回滚 |
| B | 重开浮层 → 换一档（第二次重建）→ `⇧Escape` → 裸 `Esc` | 修饰键只消费默认行为、不关层也不移焦点；裸 `Esc` 才收层并回焦 |

**A 段是本缺陷的原现场**（finding `20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`，
severity high）：浮层选定一档后重建内容，原先持焦的档位按钮被摘除、焦点回到 `body`，面板的
Escape 处理器挂在 `panel` 容器上收不到这一拍按键，也没有任何代码 `preventDefault`，于是未消费的
`Escape` 落到原生窗口关闭链、进程退出。A 段「按 Esc」之后的断言组是「不退出 + 只收浮层 + 回焦 +
文档不变」的判据；B 段的焦点断言是「重建保焦」（语义键 = 段 + 该项 id）的判据。

## 断言口径与已知边界

- **浮层项必须用真实鼠标点击驱动**（`clickInNode`，不是 `click` 的 AX 索引路径）：KimiCU 的索引
  路径发的是 `AXPress`，它**不移动 DOM 焦点**——2026-10-24 的首次红跑用 AXPress 点「完全访问」
  时焦点一直在 composer 上，重建摘除的根本不是持焦件，于是按 Esc 走了面板的就地处理器、
  app 没有退出（红跑读数为「Esc 后应用仍在」）。缺陷的成因是「持焦件被重建摘除」，所以这一击
  必须是真点击：`clickInNode` 走真实坐标通道，点击后 DOM 焦点落在该 `AXMenuItem` 上。
- **判别串选「别的档」的释义**：chip 的读屏名（D426）含**当前档**的全名与释义，所以「完全访问」
  这类串在 chip 与浮层里都出现，用它判「浮层开着」是假绿。本场景统一用只读档的释义
  （D430「读自动放行；写操作都先问你」）判浮层在场——切到完全访问档后它只可能来自浮层列表。
- **focus 断言走解析结果**（`ax: { focused: … }`）：要求 AX 里**恰有一个** focused 节点且 role
  命中；不用跨节点正则（REVIEW.md「断言等价于子串」条）。浮层项在 WKWebView 的 role 不稳定
  （`role=menuitemradio` 未必映射 `AXMenuItemRadio`，见场景 102 的登记；本机实测映射为
  `AXMenuItem`），故给的是闭集合正则。
- **两个 sleep 步的理由**：Esc / ⇧Esc 之后的收层、回焦是同步的，但「退出提示」这类瞬时 toast
  要几百毫秒才渲染——`ax: { not: … }` 紧贴按键读会恒真（REVIEW.md「读不到当成空」条的另一面）。
  留一拍再断言，负向判据才有区分度。
- **不做「点 chip 收浮层」的替代**：本场景必须让 `Escape` 自己成为关闭路径——改成点 chip 会让
  套件不再看这条缺陷路径（proposal 的非目标「不用改验收场景规避」）。场景 231 的第二段用的仍是
  chip 关闭（那一场景不判 Esc），两处不冲突。
- **只覆盖权限浮层与就地准入**：合并选择器的三段重建、effort 提示、Context hover 泡、会话浮层、
  ⌘P / 大纲 / vault 切换器 / 搜索面板 / 键位面板 / 菜单 / 三种全屏遮罩的逐类回归在同批场景
  233（全屏遮罩）、230（⌘P）、13（大纲）、17（vault 切换器）等既有场景里跑，本轮只在
  `tests/visual/scenes/escape-admission.spec.ts` 做真实 DOM 的逐类准入矩阵。
- **IME 组合期不在真机层判**：KimiCU 构造不出 `isComposing`，该分支由
  `escape-admission.spec.ts` 的真实 `KeyboardEvent{isComposing:true}` 承担（设计 §5.1 第 2 条）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；`config.json` 的
  `harness.permission_mode` 在本场景内两次写回（`full_access` → `vault_write`），场景结束后由套件
  按场景配置重置。文档 `harness-note.md` 全程逐字节不变（两条 `unchangedSince` + 一条
  `mtimeUnchangedSince`）。
- 真实 vault 与 `~/.config/lumir` 全程不读写；1420 端口不碰（套件走 `LUMIR_ACCEPTANCE_PORT`）。
