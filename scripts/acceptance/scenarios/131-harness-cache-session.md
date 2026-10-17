---
# M443（change harness-cache-metrics）：cache 读数改可解释口径后的**真机读数面**——控制行主读数是
# 会话累计（不再被一次大块新增打到低谷），气泡的命中率行与控制行同源；
# 且切换 vault 再回来读数仍来自 core 侧的会话快照（不是前端自行累加）。
# M533：气泡行集精简——单回合命中行 / 成因句 / 缓存写入行退场，本场景改为判这三者**不上屏**
# （fixture 两轮都带着这些读数）+ 命中率行只出百分比。
id: "131-harness-cache-session"
item: 131
title: Harness 缓存读数①：控制行显示会话累计命中率、气泡命中率行同源（单回合值 / 成因句 / 写入行不上屏）、切 vault 回来读数仍在
open: harness-note.md
marker: "HNL-ALPHA"
# 两轮 mock：首轮 cached==0（典型冷启动）、次轮高命中（60000/65536 = 92%）。
# 会话累计 = (0+60000)/(65536+65536) = 45.78% → 46%；单回合 92%。两个值必须**分得开**
# （否则「控制行显示累计」这条判据没有区分度）。
# cache_write_tokens 两轮都非零：M533 前用来断言气泡第四行的两个数——现改为判「写入行不上屏」
# （该值只进 wire 留存）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-cache-two.json"
seed:
  # 两个 vault 都预注册：本场景的提问与切回都走 ⌘O 的注册表行（同源会话键）——与场景 96 同一
  # 手法，理由见该场景正文「会话键的拼写依赖」。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 起始态：A 已装载、harness pane 按存储装配
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/"]
    timeoutMs: 40000

  # ── 预跑一遍切换：把 A 的会话键固定到「注册表路径」这一侧 ─────────────────────────
  # 启动恢复用的是配置里的 last_vault（`/tmp/...`）、注册表里存的是 realpath（`/private/tmp/...`）
  # ——两种拼写 = 两个会话（场景 78/96 的既有覆盖边界）。本场景的首次提问与切回必须同源，故
  # 先切到 B、再经注册表行切回 A，此后一切交互都在那个会话上。
  - name: ⌘O 打开 vault 列表
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 B 行切走
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
  - name: ⌘O 再打开列表
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 A 行切回（注册表路径；`名称 + 空格` 锚定排除 `-b` 行）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }
  - name: 等 A 装载完成、面板随存储重新装配
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "vault：lumir-m102-acceptance（点击查看全部 vault）"]
    timeoutMs: 60000
    expect:
      - label: 这条路径下 A 的会话是新的（空态提示在场 = 会话被重置的正观测）
        ax: { has: "与当前文档对话" }
      - shot: 01-起始态

  # ── 第一轮：冷启动（cached_tokens == 0）────────────────────────────────────────
  - name: 点 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|cache" }
    text: "cache"
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "cache" }
  - name: 发送
    do: key
    key: enter
  - name: 等第一轮回答到达
    do: waitFor
    waitFor:
      has: ["第一轮回答。"]
    timeoutMs: 60000
    expect:
      - label: 控制行 = ctx 50%（65536/131072）· 会话累计 0%（首轮 cached==0 ÷ 本会话 Σinput）
        ax: { has: "50% · 0%" }
      - shot: 02-首轮-控制行

  - name: hover 读数（锚点 = 读数左邻的权限 chip：ctx 读数在 AX 里没有 bbox，见 README 的 hover 条）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡第一行 = 上下文已用/上限 tokens + 百分比（M526 起 D463 tokens 形态；M532 起 k/m 单位）
        ax: { has: "/上下文：已用\\s*65\\.5k\\s*\\/\\s*131k\\s*tokens（50%）/" }
      - label: 命中率行 = 会话命中率**只出百分比**（M533 精简的 D465：本回合缓存全冷、会话累计 0%）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*0%/" }
      - label: 本回合命中行整行不渲染（M533 退场；本回合 0% 这条读数现在只留在 wire 留存里）
        ax: { not: "本回合缓存命中" }
      - label: 冷启动成因句也不上屏（M533 随本回合行一并退场；后端 `cache_note` 仍进留存）
        ax: { not: "非异常" }
      - label: 缓存写入行整行不渲染（M533 退场——本 fixture 两轮都有写入值，此刻也不该有这一行）
        ax: { not: "缓存写入" }
      - label: 未越警示线（50 < 85）——气泡里没有警示句
        ax: { not: "越过 85% 警示线" }
      - shot: 03-首轮-hover气泡

  - name: 移开读数（移到发送钮）——气泡随 mouseleave 收起
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：这次读取真的读到了一个活着的面板）
        ax: { has: "50% · 0%" }
      - label: 气泡收起后含义行不在 AX 树里（负向断言的正观测 = 上一步曾读到用法行与命中率行）
        ax: { not: "缓存命中率" }

  # ── 第二轮：高命中（cached 60000/65536 = 92%）——控制行主读数仍是累计 ────────────
  - name: 点 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入第二个提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|again" }
    text: "again"
  - name: 发送
    do: key
    key: enter
  - name: 等第二轮回答到达
    do: waitFor
    waitFor:
      has: ["第二轮回答。"]
    timeoutMs: 60000
    expect:
      - label: 控制行 = ctx 50% · 会话累计 46%（(0+60000)/(65536+65536)，不是单回合的 92%）
        ax: { has: "50% · 46%" }
      - label: 控制行不是单回合值（92% 这条读数 MUST NOT 出现在控制行）
        ax: { not: "50% · 92%" }
      - shot: 04-次轮-控制行

  - name: hover 读数
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 命中率行 = 46%（与控制行同一个数，两条通道同源；M533 精简的 D465 只出百分比）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*46%/" }
      - label: 本回合命中行不渲染（M533 退场——单回合 92% 这条读数不再有任何上屏面，
          控制行不跳崖的判据仍由上面那条「46% 而不是单回合值」守住）
        ax: { not: "本回合缓存命中" }
      - label: 成因句不上屏（M533 退场；本轮新增 5536 ≤ 已缓存 60000 的一半 ⇒ 后端也不标成因）
        ax: { not: "本回合未命中缓存" }
      - label: 大块摊薄句同样不在
        ax: { not: "命中率被摊薄" }
      - label: 缓存写入行不渲染（M533 退场；本轮 cache_write_tokens = 5536 在场也不出这一行）
        ax: { not: "缓存写入" }
      - shot: 05-次轮-hover气泡

  - name: 移开读数
    do: hover
    target: { role: AXButton, name: "^发送$" }
    expect:
      - label: 移动后读数仍在屏上（正观测：面板活着）
        ax: { has: "50% · 46%" }
      - label: 气泡已收起（前一步读到过它的内容，本步读不到——负向断言有正观测配对）
        ax: { not: "本回合缓存命中" }

  # ── 切走再切回：控制行读数仍来自 core 侧的会话快照（前端不自作累加）──────────────
  # 套件没有触发前端整页重载的动作（`restart` 会连 Rust 进程一起重启）；重载后读数回归走的是
  # 同一个 `restoreSnapshot`，这里用「切 vault 再切回」这条同源通道（场景 96 同一手法）。
  - name: ⌘O 打开列表（切走到 B）
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 B 行切走
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载完成
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
  - name: ⌘O 再打开列表（切回 A）
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 A 行切回（同一注册表路径 = 同一个会话键）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }
  - name: 等 A 装载完成、快照恢复跑完
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "vault：lumir-m102-acceptance（点击查看全部 vault）"]
    timeoutMs: 60000
    expect:
      - label: 恢复路径不把会话清空（transcript 有内容：空态提示已被摘掉）
        ax: { not: "与当前文档对话" }
      - label: 控制行读数仍在 = 50% · 46%（来自 core 会话快照的累计，不是前端自行累加的残留）
        ax: { has: "50% · 46%" }
      - shot: 06-切回-控制行

  - name: 恢复后 hover 读数
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 命中率行在恢复路径同样跟着快照回来（46% —— 与控制行同一个数；M533 精简的 D465 只出百分比）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*46%/" }
      - label: 本回合命中行不渲染（M533 退场；退场行不随恢复路径回来）
        ax: { not: "本回合缓存命中" }
      - label: 缓存写入行不渲染（M533 退场；写入值只在 wire 留存里）
        ax: { not: "缓存写入" }
      - shot: 07-切回-hover气泡
---

# 131-harness-cache-session —— 会话累计主读数 + 恢复路径读数（M443 建、M533 改行集）

## 本场景在验什么

change `harness-cache-metrics` 的第一条（裁决点 1 / 3 / 4 的 A 案）：

1. 控制行的 cache 读数改成**本逻辑会话累计命中率**（`cache_pct_session`）——Alex 2026-10-10 的
   原始现场是「一个会话里 cache hit 很低，只有 50%」，调查后确认那是**单回合口径的算术摊薄**
   （前缀全命中 + 新增一大块工具输出），不是缓存失效。改口径后控制行不再跳崖。
2. **气泡的命中率行与控制行同源**（会话累计），本场景判这条同源：两轮之后气泡里读到的 46%
   必须与控制行的 46% 是同一个数。
3. 读数真源在 Rust 侧的 `Session`（累计器），前端不自行累加——切走再切回（同一个
   `restoreSnapshot` 通道）读数必须原样回来。
4. **M533 行集精简后本场景新增的一面**：单回合命中率、两句成因句与缓存写入行都不再上屏——
   fixture 两轮都带着这些读数（首轮 0%/冷启动、次轮 92%/写入 5536），此刻气泡里 MUST NOT 出现
   对应的行或句（负向断言配「含义行在场」的正观测）。

## 断言口径与区分度

- **两个读数必须分得开**：两轮 mock 取「首轮 cached==0 + 次轮 60000/65536」⇒ 会话累计
  (0+60000)/(65536+65536) = 45.78% → **46%**，单回合 60000/65536 = 91.55% → **92%**。控制行
  断言 46%、并显式断言不是 `50% · 92%`（旧口径会显示这个值）——这条判据因此对新旧实现有区分度
  （REVIEW.md 「断言等价于子串」条：先造一个必须让它 FAIL 的输入）。**M533 之后 92% 这条读数不再有任何上屏面**
  （气泡的单回合行退场）：本场景不再断「92% 出现在气泡里」，而断「它不出现在气泡里」——控制行那条
  负向断言（`not: "50% · 92%"`）仍是它唯一的上屏面判据。
- **负向断言都配正观测**：气泡里的「没有本回合行 / 没有成因句 / 没有写入行 / 已收起」几类负断言，
  各自在同一步先断含义行在场（`上下文：已用 65.5k / 131k tokens（50%）` /
  `缓存命中率（会话）：46%`），不用「读不到就当没有」（REVIEW.md 「读不到当成空」条）。
- **hover 的落点**：ctx 读数在 AX 树里是**没有 bbox** 的 `AXStaticText`（WKWebView 对 inline-flex
  里的裸 span 不给框），因此不能按节点定位；动作的 `target.anchor` 形态锚在它左邻的权限 chip
  （有 bbox、位置随布局走）上，再向右偏移 24px 像素（控件行 gap 4px + 读数约 50px 宽，落点在
  读数正中）。README「动作」表与「已知边界」的 hover 条有这条通道的来历与边界。
- **气泡断言写成「换行容忍」的正则**（`\s*` 落在标点 / 分隔符处）：气泡宽 224px，长句必然折行，
  而 AX dump 里折行处会多出一个空白（对照现场：`与当前文档对话——发送时会携带上方显示的上下文，
  发送前可核对。 上下文：harness-note.md`）——写死逐字串会随折行位置随机假红。正则仍钉住「同一行
  里的整句 + 两个数」，不是退化成子串（REVIEW.md 「断言等价于子串」条）。
- **恢复路径**：套件没有触发前端整页重载的动作（`restart` 会连 Rust 进程一起重启、core 的内存态
  会话随之清空），故用「切 vault 再切回」这条同源通道——它与重载走同一个 `restoreSnapshot`
  （做法与登记口径同场景 96）。会话键的拼写依赖（提问与切回都走注册表行）同样照场景 96。

## 覆盖边界（如实登记）

- 本场景判的是**读数面与恢复面**；成因判定的真值表（冷启动 / 摊薄 / 稳态 / input==0 边界）与累计
  口径（Σcached ÷ Σinput、新逻辑会话清零）在 Rust 单测里（`src-tauri/src/harness/session.rs` 的
  tests 与 `src-tauri/tests/harness_runtime.rs`），本场景不重复——M533 后成因句没有上屏面，
  「判定真值表」这层覆盖只剩 Rust 单测与 wire 留存。
- **自动压缩后累计重新起算**这条不在真机场景里判（压缩的触发与后一轮读数由
  `harness_runtime.rs::session_cache_reading_restarts_after_auto_compact` 钉）。
- 真 provider（Kimi Code 端点）实测 `cache_write_tokens` 恒 0；M533 后该字段（与单回合命中率、
  成因标注）只进 wire 留存、不再上屏，本场景的负向断言对 mock fixture 与真 provider 同样成立。
