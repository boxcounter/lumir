---
# M460：Alex 2026-10-12 dogfood 两条反馈的真机判据——
#   「harness pane 里的表格里的链接没有渲染出来……但在会话 JSONL 里是有链接的」
#   「恢复的会话里，没有显示消息时间」
# 判的是两条**呈现面**的端到端：正文里的裸 URL 在真机渲染里可见（段落与表格 cell 两类宿主）、
# 会话恢复重放出来的消息带时间读数。后端的 ts 归属（JSONL 信封 → 面板消息）不可从 AX 反推，
# 判据在 src-tauri 的单测上（见正文「断言口径」）。
id: "152-harness-transcript-link-and-time"
item: 152
tier: full
title: harness transcript：裸 URL 在段落与表格里上屏为链接、恢复重放的消息带时间读数
open: harness-note.md
marker: "HNL-ALPHA"
# 一轮 mock 回答同时含三类形态（段落裸 URL / 表格 cell 裸 URL / 标准链接），全合成域名。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-link-time.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板以旁侧 pane 出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 点 composer 聚焦并输入提问
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|lktsmark" }
    text: "lktsmark"
    expect:
      - label: 提问落进 composer（注入落地的正观测）
        ax: { has: "lktsmark" }
  - name: 发送
    do: key
    key: enter

  - name: 等 mock 回答渲染完（缺陷一与缺陷二共用这一轮回答的正文）
    do: waitFor
    waitFor:
      has: ["段落里的裸链接"]
    timeoutMs: 30000

  - name: 缺陷一：正文里的链接上屏形态（段落 + 表格 cell + 标准链接）
    do: settle
    expect:
      - label: 段落里的裸 URL 上屏（修复前整段 UUID 被跳过 ⇒ 该串在 AX 里不可读）
        ax: { has: "https://example.com/para/x" }
      - label: 表格 cell 里的裸 URL 上屏（Alex 现场的那一格）
        ax: { has: "https://example.com/cell/y" }
      - label: 标准写法照旧渲染（回归面：三段形态并存时链接数不丢）
        ax: { has: "示例站点" }
      - label: 标准链接的 URL 不作为可见文本二次上屏（URL 只作 href——不重复上屏的回归判据）
        ax: { not: '/= "https:\/\/example\.com\/std\/z"/' }
      - shot: 01-live-链接上屏

  - name: 点「＋新会话」把源会话切成历史会话（＋钮是唯一叫「新会话」的 AXButton）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成（transcript 回到空态——resetView 的正观测）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（会话名 = 首条用户消息的提问段，注入的上下文节已由后端剥除）
    do: waitFor
    waitFor:
      has: ["lktsmark"]
    timeoutMs: 15000
    expect:
      - label: 选择器列出源会话
        ax: { has: "lktsmark" }
      - shot: 02-选择器

  - name: 点历史会话行——恢复重放（读末条 llm_request、折叠末尾响应；
      menu item 嵌进行壳后索引点击报 stale，行走 clickInNode 坐标通道，与场景 106 同法）
    do: clickInNode
    target: { name: "lktsmark" }

  - name: 等恢复完成（会话名落回源会话首条用户消息）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(lktsmark/"]
    timeoutMs: 15000

  - name: 缺陷二：恢复重放的 transcript 带时间读数
    do: settle
    expect:
      - label: transcript 重建出源会话的正文（该文案只可能来自恢复出来的历史）
        ax: { has: "段落里的裸链接" }
      - label: 恢复的用户消息带时间读数（角色节点与紧邻的时间节点成对；修复前 ts=0 ⇒ 只有角色、无读数）
        metaLine: { role: "你", time: '/^· [0-9]+ ?(秒|分钟|小时)前(?![\s\S])/' }
      - label: 恢复的助手回复同样带时间读数
        metaLine: { role: "Agent", time: '/^· [0-9]+ ?(秒|分钟|小时)前(?![\s\S])/' }
      - label: 空态提示已摘掉（transcript 非空的构造性正观测，与场景 96 同口径）
        ax: { not: "与当前文档对话" }
      - label: 恢复的正文里裸 URL 仍上屏（重放走同一份渲染器，两类宿主都不例外）
        ax: { has: "https://example.com/cell/y" }
      - shot: 03-restored-时间读数
---

# 152-harness-transcript-link-and-time —— 两条呈现面缺陷的真机判据（M460）

## 本场景在验什么

Alex 2026-10-12 dogfood 的两条反馈：

1. 「harness pane 里的表格里的链接没有渲染出来……但在会话 JSONL 里是有链接的」——面板正文渲染器把
   GFM 的**顶层 `URL` 节点**（裸 `https://…` / 无 scheme 的 `www.…` / 邮箱字面量）整段跳过，
   于是 URL 在面板里隐身；表格只是最容易注意到的一格。
2. 「恢复的会话里，没有显示消息时间」——会话恢复重放的面板消息 `ts` 恒为 0（= 无读数），
   meta 行只剩角色。

本场景判**真机渲染面**的端到端形态：正文里的裸 URL 在段落与表格 cell 两类宿主下都上屏、
标准链接的 URL 不重复上屏、恢复重放出来的消息带时间读数。

## 断言口径

- **正面判据（有区分度）**：两条 URL 断言取**URL 原文串**——修复前这两串在 AX 树里完全不可读
  （整段节点被跳过、不是「渲染了但样式不对」），因此「串在场」= 「上屏了」。`示例站点` 那条是
  回归面：三段形态并存时链接数不丢。
- **`not` 判据限定到可见文本形态**：`https://example.com/std/z` 只作为 `[示例站点](…)` 的 href——
  `createLinkEl`（`src/harness-panel.ts:2216-2226`）刻意 `el.href = href; el.title = href`，HTML 的 `title`
  在 AX 里映射成锚的 `help=` 属性。断言引擎在**整份 AX 文本**上做子串匹配，`help="…"` 连同被搜 ⇒ 裸串
  负断言会被属性值误命中（`not` 因此恒红）。故断言写成可见文本形态 `/= "…"/`：`= "…"`（等号 + 空格 +
  引号）是 `AXStaticText` 的**值**形态，属性形态是 `help="…"`（等号紧贴引号、无空格），两者可清晰区分。
  它同时是一条构造性判据——若渲染器把 `Link` 之下的 URL 子节点也上屏一次，就会产出一个
  `= "https://example.com/std/z"` 的 `AXStaticText`，本场景因此同时钉住「独立 URL 节点」与「Link 子节点」的区分。
- **时间读数的判据落在 who 行，且按树结构判**：真机 AX 把 who 行渲染成**两个相邻的
  `AXStaticText`**——`你` 与 `· 3秒前` 各占一个节点（2026-11-23 的真机读数，Agent 同形：
  `[210] AXStaticText = "你"` / `[211] AXStaticText = "· 3秒前"`）。连续文本判据
  `/你 · ?[0-9]+ ?(秒|分钟|小时)前/` 因此永远跨不过节点边界：读数在场（截图可证）而断言判红
  ——首跑的两条假 FAIL 即此。改用 `metaLine: { role, time }`：文本**恰等于**角色的节点之后，
  紧邻的下一个**同级节点**必须是可读的 `AXStaticText` 且其文本命中时间读数。失败面全部判红：
  角色节点缺失、后面没有同级节点、相邻节点不是时间读数（错配）、相邻节点不可读、快照退化
  （0 节点）。时间读数取**恢复档自己的**合法集合（`whenTextOf(..., "restored")` →
  `sessionWhen`）：同日只产 `N秒前` / `N分钟前` / `N小时前`（`0秒前` 合法），跨天是短日期
  （本场景造不出跨天现场，见覆盖边界）。**live 档专属的「刚刚 / 昨天」不在这条断言的接受集合**：
  恢复路径误接 live formatter 时必须判红（单测用 `· 刚刚` / `· 昨天` 两条反向输入钉住）——
  恢复读数来自留存，可以很老，「昨天」对一周前的消息是错读数，放进来就是判据弱化。修复前恢复
  出来的消息 `ts = 0`，meta 行只有角色、读数节点根本不存在 ⇒ 有区分度。
- **恢复确实发生了**：`段落里的裸链接` 只可能来自重放的历史（＋新会话已把 transcript 清空、
  且新会话不会再发请求），它与会话名落回 `lktsmark` 一起构成「恢复跑了」的正观测。

## 覆盖边界（如实登记，别读成「已覆盖」）

- **本场景已真机跑过一次（2026-11-23），但改断言后的复跑尚未执行**：那次运行里两条时间断言
  判红，而截图显示读数在场、AX dump 显示 who 行是两个相邻节点——即**断言形态问题，不是产品缺陷**
  （steps.md 与 dump 的本地留存见 `.local/missions/harness-time-ax-nov23/`，git 外）。同一 run 里
  URL 四条断言全 PASS。断言改为 `metaLine` 后，以该 dump 做先红后绿 / 反向验证（同目录）；
  真机复跑由主会话排期。
- **跨天读数不在本场景**：套件没有预置「新布局留存（`sessions/<vault id>/<id>.jsonl`）」的种子
  （`seed.harnessFlatSessions` 是**旧布局**的孤儿文件，产品不列举也不恢复它），因此恢复的对象只能是
  本场景自己刚建的会话（同日）。跨天档（短日期）的判据落在 `tests/unit/harness-transcript-render.test.ts`
  与 `tests/visual/scenes/m460-harness-transcript-link-and-time.spec.ts`（桩给一个三天前的 ts）。
- **后端的 ts 归属不在本场景**：AX 反推不出「这条 ts 来自哪条记录」——归属走查的判据在
  `src-tauri/src/harness.rs` 的单测（`restored_messages_ts_walks_the_record_sequence` /
  `restored_panel_messages_carries_envelope_ts_per_item`）与 `jsonl.rs` 的
  `read_session_file_keeps_per_record_envelope_ts`。本场景只判「有读数」这一层。
- **链接点击不在这里判**：`click` 动作不带修饰键、面板链接也不要求修饰键（与编辑器 ⌘-Click 不同），
  但真机点击会真的呼起系统浏览器（本套件不开这个口）。点击→`open_external_url` 的接线判在
  `tests/visual/scenes/m460-harness-transcript-link-and-time.spec.ts`（桩记录被交给后端的 URL）。
- **无 scheme 字面 URL（`www.` / 裸邮箱）不在本场景**：它们同样被修复（GFM 同一种节点），
  但点击必被后端白名单拒绝且面板静默（既有边界），真机判它们只添噪声；判据在单测里。

## 环境与副作用

- 合成 fixture（`harness-mock-link-time.json`，`example.com` 域）与隔离 `XDG_CONFIG_HOME`；
  端口走 `LUMIR_ACCEPTANCE_PORT`（缺省 1430），1420 全程不碰。本场景不写 vault（无工具调用）。
