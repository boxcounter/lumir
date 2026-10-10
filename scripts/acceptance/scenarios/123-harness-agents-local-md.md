---
id: "123-harness-agents-local-md"
item: 123
title: vault 根 AGENTS.local.md 自动装配为第三层（本地覆盖层排在 vault 根 AGENTS.md 之后）
open: harness-note.md
marker: "HNL-ALPHA"
# fixture = 套件里最简的一轮 mock 脚本（正文 + usage）；本场景只关心首行 session_open
# 的装配事实，不发工具、不跑循环。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 预置 vault 根 AGENTS.md（本场景的「入库」指令文件，合成 fixture）
    do: vaultWrite
    file: AGENTS.md
    content: "VAL-ROOT-AGENTS 是 vault 根 AGENTS.md 的合成标记串。"
  - name: 预置 vault 根 AGENTS.local.md（本机私有覆盖层，合成 fixture）
    do: vaultWrite
    file: AGENTS.local.md
    content: "VAL-LOCAL-AGENTS 是 vault 根 AGENTS.local.md 的合成标记串。"
  - name: 外部写入后留一拍再读界面（README「外部写入后先留一拍」，≥1s）
    do: sleep
    ms: 1000

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }
      - shot: 00-面板就位

  - name: 抢前台（真鼠标点击要求窗口在前台；同机别的 app 抢走前台时会丢点击与丢键——REVIEW.md 第 11 条）
    do: focusWindow

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
    expect:
      - label: composer 是唯一获焦节点（键盘落点的正观测——keys 的回读目标因此稳定在 composer）
        ax: { focused: "AXTextArea" }

  - name: 输入提问
    do: keys
    keys: ["a", "g", "e", "n", "t", "s"]
  - name: 发送（会话在这里建立，装配同时发生——两份 AGENTS 文件已在 vault 根）
    do: key
    key: enter

  - name: 等回答到达（会话建立 + 首行 wire 留存落盘）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 回答渲染（回合真的跑完）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 装配清单记录本地层且文件在场（exists:true，路径以 AGENTS.local.md 结尾）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"exists":true,"path":"[^"]*AGENTS\.local\.md","source":"agents_vault_root_local".*$/' }
      - label: 装配清单记录 vault 根 AGENTS.md 在场（exists:true）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"exists":true,"path":"[^"]*AGENTS\.md","source":"agents_vault_root".*$/' }
      - label: system prompt 含两份内容，且本地层排在 vault 根 AGENTS.md 之后（顺序不变量）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*VAL-ROOT-AGENTS.*VAL-LOCAL-AGENTS.*$/' }
      - label: 本地层节标题显式声明覆盖优先级（「冲突时以此为准」对模型可读）
        file: { path: "env:harness/sessions/*.jsonl", has: "本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准" }
      - shot: 01-回答
---

# 123-harness-agents-local-md —— vault 根 AGENTS.local.md 自动装配（change `harness-agents-local-md`）

## 本场景在验什么

Alex 原话（2026-10-10）：「Harness 增加自动加载 project-wide AGENTS.local.md，如果它存在」。

装配层从两层扩为**三层**：user-wide（`~/.agents/AGENTS.md`）→ vault 根（`<vault>/AGENTS.md`）
→ vault 根本地覆盖层（`<vault>/AGENTS.local.md`）。第三层排 vault 根 `AGENTS.md` 之后注入，
在系统上下文里承担「本机本地覆盖层、冲突时以此为准」的语义——该优先级由**注入位置 + 节标题**
共同表达，系统不解析、不合并两层内容。

本场景是**行为面**的判据（机器面另有 `context.rs` 的单测钉三处齐备 / 缺失静默跳过 /
清单条目两态）：真实 WKWebView 实例里发一轮消息，读会话 JSONL 首行 `session_open`，
断言装配清单与 system prompt 的顺序与覆盖声明。

## 断言口径

- **两份文件由 `vaultWrite` 在场景内写出**（不是套件 fixtures）：`fixtures/` 下的 `.md` 会被
  `resetVault()` 拷进**每一个**场景的 vault 根（那是全量共享的重置路径），把 `AGENTS.md` /
  `AGENTS.local.md` 放进 fixtures 会让所有 harness 场景的系统上下文都多出两层内容——
  blast radius 覆盖全量场景，故本场景自己写、只影响自己。两份文件名都以 `.md` 结尾，
  `resetVault()` 的「清根下 `.md`」因此照常把它们清掉，不跨场景残留。
- **写入必须在发消息之前**：装配发生在会话建立（`acquire_turn` → `ensure_session`）那一刻，
  即本场景 `do: key key: enter` 那一步；此后写文件对本会话无效（无文件 watcher，design §3）。
- **`exists` 两态**：本场景钉 `exists:true` 一态；「文件不存在仍记 `exists:false`」一态由场景
  105（合成 vault 根无 AGENTS 指令文件）的同款断言覆盖，两景合起来才是 spec 的完整口径。
- **顺序判据**用一条整行正则（`VAL-ROOT-AGENTS` 在前、`VAL-LOCAL-AGENTS` 在后）：JSONL 一行一
  事件，两个标记串只可能由 system prompt 全文带进来，`m` 下的 `^…$` 因此钉的是「同一条
  `session_open` 记录里、前串先于后串」——不是「两串都出现过」（REVIEW.md 第 1 条）。
- **路径断言不写死 `/tmp`**：app 侧的 vault 根路径可能是 `/tmp/...` 或 `/private/tmp/...`
  （注册表存 canonicalize 后的路径），故路径片段用 `[^"]*` 通配、只钉文件名与来源名
  （与场景 105 同口径）。
- **不断言 user-wide AGENTS.md**：它的路径含真实用户名、各机可能不存在（信息卫生纪律，
  REVIEW.md 第 17 条）。
- **抢前台 + 焦点正观测**：点 composer 前的 `focusWindow` 与点后的 `focused` 断言是首次真机
  跑（2026-10-10）暴露出来的：那条运行里窗口在前台被中途抢走（AX 快照里**没有任何**
  `(focused)` 节点、window_bounds 变成整屏），随后键盘注入 3 次全不落地——与产品行为无关，
  但失败信号会指向场景。这两步把它变成可归因的环境 FAIL（`focusWindow` 拿不到前台即报错），
  与场景 64 / 66 / 82 的前台纪律同一条。
