---
id: "95-harness-thinking-effort"
item: 95
title: 思考程度会话态（M373 并入合并 chip）：默认 High → 浮层三档 → 选 Max 读数翻转 → 新会话回 High
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking.json"
seed:
  # 预置「上次会话里 harness 面板在场」⇒ 启动即装配出面板（不经 ⌘⇧A 键盘通道——本机 12:19
  # 起合成键盘事件系统级不落地时，本场景仍可跑；chip / 浮层 / 新会话三处交互全是点击）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等启动恢复落定——面板与思考 chip 就位
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "模型：mock · 思考程度：High（点击切换）"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 合并 chip 默认读数 = mock · High（D393 读屏名；mock 档 supported=true）
        ax: { has: "模型：mock · 思考程度：High（点击切换）" }
      - shot: 01-默认-High

  - name: 点合并 chip 展开三维浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton，target 不锁 role）
    do: click
    target: { name: "^模型：" }
    expect:
      - label: 浮层 effort 段三裸档 Low / High / Max 全在（无每档释义——Alex 裁决 7；ASCII 括号锚 AX 节点名）
        ax: { has: "/\\(Low\\)/" }
      - label: High 档在
        ax: { has: "/\\(High\\)/" }
      - label: Max 档在
        ax: { has: "/\\(Max\\)/" }
      - label: 展开浮层不改 chip 的读数（chip 仍在、仍是 High）
        ax: { has: "模型：mock · 思考程度：High（点击切换）" }
      - shot: 02-三档浮层

  - name: 点 Max 档——选择即写会话（浮层项 role=menuitemradio，target 只给裸正则源 name）
    do: click
    target: { name: "^Max$" }

  - name: 等 chip 读数翻成 Max（选择先行，命令写会话随后）
    do: waitFor
    waitFor:
      has: ["模型：mock · 思考程度：Max（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: chip 读数 = 新选择 Max（D393 读屏名随会话态翻转；M373 起选定不关浮层——浮层开合另由 m347 视觉场景钉）
        ax: { has: "模型：mock · 思考程度：Max（点击切换）" }
      - shot: 03-选后-Max

  - name: 点「＋新会话」钮（会话名钮是 AXPopUpButton；＋钮是唯一叫「新会话」的 AXButton，role 分流）
    do: click
    target: { role: AXButton, name: "^新会话$", nth: 0 }

  - name: 等新会话生效、chip 回到默认 High（会话被丢弃 ⇒ core 档位回默认 High）
    do: waitFor
    waitFor:
      has: ["模型：mock · 思考程度：High（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 新会话后 chip 读数 = 默认 High（裁决点 1：新会话回到默认，不写回配置）
        ax: { has: "模型：mock · 思考程度：High（点击切换）" }
      - label: 视图回到空会话态（resetView 的构造性判据——会话确实被新建）
        ax: { has: "与当前文档对话" }
      - shot: 04-新会话-回-High
---

# 95-harness-thinking-effort —— 思考程度 chip 的会话态（change add-harness-thinking-display-and-effort §6.3 后半）

## 本场景在验什么

composer 控制行的思考程度 chip（M363）在真机上的完整会话态回路：

1. **默认 High**：mock 档 `thinking.supported = true`（schema 判定对 mock 恒真），快照
   `thinking.level` 默认 `high` ⇒ chip 读屏名 = D393「模型：mock · 思考程度：High（点击切换）」。
2. **浮层三裸档**：点 chip 展开三维浮层，effort 段列出 Low / High / Max 三档（无每档释义——
   Alex 裁决 7）。
3. **选择写会话**：点 Max ⇒ chip 读数翻 Max（落 `harness_set_thinking_effort`，会话内生效；
   M373 起选定不关浮层）。
4. **新会话回默认**：点「＋新会话」⇒ 会话被丢弃、core 档位回默认 High ⇒ chip 读数回 High
   （Alex 2026-10-06 裁决点 1：会话内生效、不写回配置、新会话回到默认）。

## 断言口径

- **chip 读屏名取 D393**（`模型：{model} · 思考程度：{level}（点击切换）`，M373 合并形态）：chip 带 `aria-haspopup="menu"`，
  与场景 90 同构：WKWebView 把带 haspopup 的 `<button>` 映射成 `AXPopUpButton`，
  可访问名取 `aria-label`/`title`（= D393）。两个点击 target 因此**不锁 role**、只给裸正则源
  `name`（`findNode` 对 title/label/value 逐一匹配）。
- **浮层三档用 ASCII 括号锚节点名**（`(Low)` / `(High)` / `(Max)`）：AX 把浮层项渲染成
  `AXMenuItem (Max)` 形态；chip 的读屏名用**全角**括号（「模型：mock · 思考程度：High（点击切换）」），
  与 ASCII 括号不互相误命中。**不锁 role**：`role=menuitemradio` 在 WKWebView 里未必映射成
  `AXMenuItemRadio`（场景 90 实测渲染为 `AXMenuItem`）。
- **「当前档 aria-checked」不在真机直接判**：浮层当前项靠 `.is-current` + 勾选 SVG
  （`aria-hidden`）+ `aria-checked` 表达，AX 文本不暴露这些（场景 90 的同款边界：`aria-checked`
  零命中）。当前档标记归视觉层与前端单测。
- **「＋新会话」消歧靠 role 分流**（场景 92 口径）：未命名会话下会话名钮与＋钮 AX 名都是「新会话」，
  会话名钮带 `aria-haspopup` → `AXPopUpButton`，＋钮无 haspopup 保持 `AXButton` ⇒ 锁
  `AXButton` + `nth 0` 点到的是＋钮。
- **本场景不用 ⌘⇧A**：面板经 `seed` 的 `harnessPane: true` 在启动时装配（场景 91 口径），
  全程零键盘——本机 12:19 起合成键盘事件系统级不落地（finding
  `20261007-worker-cux1-bug-12-19-input-source-pro-lark-event-tap.md`）时，chip / 浮层 / 新会话
  三处交互仍然可验（全是点击）。

## 已知边界（如实登记）

- **「切档位后下一轮 mock 收到对应程度参数」不在真机断言**（M364 tower 裁决 = 方案 B）：
  真机套件没有可读 `MockClient::received_efforts()` 的通道（它是纯内存、只在 cargo test 里可达；
  harness JSONL 的 kind 集合里没有档位记录，`harness_state` 快照的 `thinking.level` 是**会话态**
  而非「请求收到了什么」）。「会话档位 → 请求参数」这条链已由 **core 集成测试**
  `session_thinking_effort_reaches_request`（`src-tauri/tests/harness_runtime.rs`）钉死——纯 core
  行为归 cargo test 层是正确的分层，真机不重复断言。本场景只验真机可观测的那一段：
  **chip 读数 = 会话档位状态**（默认 High → 选 Max → 新会话回 High）。
- **档位不落盘**：`harness_set_thinking_effort` 只写会话内存（不写回 `config.json`），故无
  file 断言可写——读数全在 AX 面（与场景 90 的模型 chip **写回** config 形成对照：模型是环境级
  偏好写回、思考程度是任务级调节仅会话内生效，这是裁决点 1 的刻意差异）。
- **原生「＋新会话」无键盘通道**：本场景刻意走点击，不依赖 Enter/⌘⇧A。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本（本场景**不发送消息**——零 mock
  往返，档位切换不触发 LLM 调用）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
