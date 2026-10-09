---
# M368：Alex 2026-10-07 现场两条缺陷的**恢复路径**判据——「连续出现 Agent · 19m ago 的字样」
# （空正文 assistant 记录被渲染成光秃 who 行）与「tool use 没有信息价值」（工具行恒为「成功」）。
# core 侧 M367 已落两件事（空轮次不再落面板消息、tool 记录持久化 summary），本场景判前端把快照
# 恢复渲染对上了没有（工具行带人话化参数、工具清单按消息分块、消息数 = 面板记录数；M406 起参数
# JSON 原文不上屏）。
id: "96-harness-transcript-restore"
item: 96
title: harness transcript 快照恢复保真：切 vault 回来后工具行带人话化参数、工具清单按消息分块、无光秃 Agent 头
open: harness-note.md
marker: "HNL-ALPHA"
# mock 两轮都发工具调用（撞名失败 + 新建成功）、第三轮收尾——落三条 assistant 面板记录 +
# 两条 tool 记录，且两次 vault_create 被中段正文（「撞名被拒了，换个新名字。」）隔开。M383
# （到达序渲染）起 live 路径也把两行拆进**单行块、不折叠**，与恢复路径一致——本场景判的是
# **恢复路径按消息边界切块**（工具行各挂各自的 assistant 消息、带参数摘要、消息数 = 面板记录数），
# 不是 live/recovery 的折叠对比（该对比随 M383 退场，见正文「断言口径」；M406 起「参数摘要」
# 改为人话化参数，JSON 原文不上屏）。
# `allow: [vault_create]` 免批准闸（写类工具默认 ask，本场景判的不是闸）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-create.json"
    permissions: { allow: ["vault_create"] }
seed:
  # 两个 vault 都预注册（`$vault` / `$vault2` 记号见套件 README）：本场景走的是**切换**
  # 而不是「首次把目录加进列表」（那条链路真机未覆盖，见 README 已知边界）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.6
      # harness_pane = true：A 的存储布局里有面板 ⇒ 每次打开 A 都重新装配出 harness pane
      # （ADR 0008 Decision 6 的消费位；场景 91 判的是这条布局位，本场景判面板内容）。
      harnessPane: true
steps:
  - name: 起始态：A 已装载、harness pane 按存储装配（空会话）
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "与当前文档对话"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  # ── 为什么先切到 B、再切回 A（而不是直接在当前这份 A 里提问）────────────────────────
  # harness 会话以 vault 根路径**字符串**为键，而同一个目录在真机上可能有两种拼写：启动恢复
  # 用配置里的 last_vault（`/tmp/...`，writeConfig 原样写），注册表里存的是 realpath 后的路径
  # （`/private/tmp/...`，app.mjs 的 writeRegistryEntry 会 canonicalize）——两种拼写 = 两个会话
  # （场景 78 的覆盖边界里钉过这条现场）。因此本场景的**首次提问**与**切回后的恢复**必须同源：
  # 都经 ⌘O 的注册表行打开 A，两步的会话键才是同一个。
  - name: ⌘O 打开 vault 列表（准备切到 B）
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }

  - name: 点 B 行——切到另一个 vault（B 没有存储的 harness 布局）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等 B 装载跑完
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  - name: ⌘O 再打开列表（切回 A，走注册表路径）
    do: key
    key: "cmd+o"
  - name: 等浮层重新出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 A 行（`名称 + 空格` 锚定，排除 `-b` 那一行——与场景 17/91 同一手法）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }

  - name: 等 A 从注册表路径装载完（面板随存储重新装配）
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "vault：lumir-m102-acceptance（点击查看全部 vault）"]
    timeoutMs: 60000
    expect:
      - shot: 02-A-注册表路径
      - label: harness pane 按存储装配（分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 这条路径下 A 的会话是新的（空态提示在场）
        ax: { has: "与当前文档对话" }

  # ── live 路径：一轮里两条工具行 → 终态折叠为一行摘要钮 ────────────────────────────
  - name: 点 composer 聚焦（面板随存储装配，焦点不在输入框里，与 ⌘⇧A 打开的形态不同）
    do: click
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["n", "e", "w", "f", "i", "l", "e"]
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "newfile" }
  - name: 发送
    do: key
    key: enter

  - name: 等工具循环跑完（撞名失败 → 新建成功 → 收尾回答）
    do: waitFor
    waitFor:
      has: ["新建完成。"]
    timeoutMs: 60000
    expect:
      # M383（到达序渲染）起 live 路径也把「正文段 / 工具块」按事件到达序交错成多段：本轮两次
      # vault_create 被中段正文（「撞名被拒了，换个新名字。」）隔开 ⇒ 各落一个**单行**工具块，
      # D387 的折叠阈值（≥2 行）不触发。旧断言「两条工具行落同一块 → 折叠为一行摘要钮」的前提
      # 是 M368 时代的「一轮一个泡」，随 M383 失效（现场与截图见 M393 findings）。
      - label: live 路径两条工具行都可见、未被折叠隐藏（失败行带错误码尾注、成功行为徽章+人话化参数）
        ax: { has: "fs_already_exists" }
      - label: live 路径成功工具行 = 工具徽章 + 人话化参数（M406 起 JSON 摘要不上屏，未被折叠隐藏）
        ax: { has: '/vault_create\s*harness-created\.md/' }
      - label: live 路径参数 JSON 原文不上屏（M406：人话化分层，JSON 只留在 JSONL 里）
        ax: { not: '{"path":"harness-created.md"' }
      - label: live 路径不出现折叠摘要（每块单行 < 2，D387 不触发）
        ax: { not: "个工具调用 · 全部完成" }
      - label: 最终回答渲染
        ax: { has: "新建完成。" }
      - label: 提问回声在 transcript 里
        ax: { has: "newfile" }
      - shot: 03-A-live-交错态

  # ── 切走再切回：transcript 由快照恢复重渲（M368 判的就是这一面）───────────────────
  - name: ⌘O 打开列表（切走到 B）
    do: key
    key: "cmd+o"
  - name: 等浮层出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 B 行——离开 A（A 的会话留在 core 内存里，事件被 vault 过滤丢弃）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载跑完
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  - name: ⌘O 再打开列表（切回 A）
    do: key
    key: "cmd+o"
  - name: 等浮层重新出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
  - name: 点 A 行（同一路径同源：这次打开与首次提问用的是同一个会话键）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }

  - name: 等 A 装载完、面板重建（恢复路径已跑完）
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "vault：lumir-m102-acceptance（点击查看全部 vault）"]
    timeoutMs: 60000

  - name: 恢复后的结构面：工具清单按消息分块（每块一行 → 不折叠）、who 行数 = 消息数
    do: settle
    expect:
      - shot: 04-A-切回恢复
      - label: transcript 有内容（空态提示是「transcript 为空」的构造性判据，已被摘掉）
        ax: { not: "与当前文档对话" }
      - label: 恢复路径不把两条工具记录堆进同一块——每块一行，故没有折叠摘要钮
        ax: { not: "个工具调用 · 全部完成" }
      # 消息数 = 4（用户 1 + assistant 面板记录 3），判据取**每条消息一个的复制钮**：空正文记录
      # 若被渲染出来就会多一个消息元素（多一个复制钮 ⇒ 5 即红），且它本身正是「空消息 MUST NOT
      # 挂复制钮」这条要求的直接落点。为什么不用「数 who 行文本」：AX 会把 who 行与其后
      # 工具块 / 相邻正文合并进同一个 AXStaticText（本次实测的 dump 就是这样），行数不随光秃头
      # 增加——那种形态在 AX 上无区分度，判据落在 tests/unit/harness-restore.test.ts。
      - label: 消息数 = 4（用户 1 + 三条 assistant 记录；空消息不渲染也不挂复制钮）
        ax: { count: { pattern: "AXButton (复制消息)", exact: 4 } }

  - name: 恢复后的内容面：工具行摘要、失败状态、正文与相对时间都在
    do: settle
    expect:
      - label: 恢复的成功行 = 工具徽章 + 人话化参数（M406：restoredAssistantToolRow 走 humanizeToolArgs）
        ax: { has: '/vault_create\s*harness-created\.md/' }
      - label: 恢复的参数 JSON 原文不上屏（M406 人话化分层在恢复路径同样生效）
        ax: { not: '{"path":"harness-created.md"' }
      - label: "失败行保留细分错误码（恢复尾注 = failureTextOf 的 `{code}: {message}`，M406 起无 `error · ` 前缀）"
        ax: { has: "/fs_already_exists: /" }
      - label: 首条 assistant 记录的正文恢复（工具轮也有正文，是本场景 mock 的形态）
        ax: { has: "先试试撞名新建。" }
      - label: 中段 assistant 记录的正文恢复（多条记录各自成泡，不合并、不丢）
        ax: { has: "撞名被拒了，换个新名字。" }
      - label: 收尾回答的正文恢复
        ax: { has: "新建完成。" }
      - label: 用户消息恢复
        ax: { has: "newfile" }
      - label: 恢复的 who 行带真实相对时间（后端 ts，M353；不伪造、也不是「角色单显」的旧快照形态）
        ax: { has: "/Agent · (刚刚|[0-9]+ 秒前|[0-9]+ 分钟前|[0-9]+ 小时前|昨天)/" }
      - shot: 05-A-恢复内容
---

# 96-harness-transcript-restore —— 快照恢复渲染保真（M368）

## 本场景在验什么

Alex 2026-10-07 现场的两条：

1. 「连续出现 Agent · 19m ago 的字样」——模型只发工具调用、无正文的轮次在 core 侧曾落一条
   `text: Some("")` 的面板消息，恢复路径照着渲染，出来就是只有角色 meta 行、body 为空的空气泡。
2. 「tool use 没有信息价值，比如 Tool done: vault_read — 成功（红框里 21 行全是这样）」——
   工具行的摘要恒为「成功」，调用了什么、带了什么参数都看不到。

core 侧的两处修复（M367）已把「空轮次不落面板消息」与「tool 记录持久化 summary」落在源头；
本场景判**前端恢复渲染**这一面：切走再切回之后，transcript 由 `harness_state` 快照重建，
工具行仍带着参数摘要、失败行仍带着状态与错误码、工具清单按消息边界分块、消息数与面板记录数
一致（没有空气泡）。

## 断言口径

- **恢复路径的构造性正观测**：`与当前文档对话`（D346 空态提示）只在 transcript 没有子节点时
  挂上（`syncEmptyHint`），故「提示不在」= 「transcript 非空」——它是负向断言的**正观测**
  （REVIEW.md 第 2 条：读不到与为空不是一回事）。切 vault 会 `resetView()` 清空渲染面，
  所以切回后看到的这份内容只可能来自快照恢复，不可能是切走前那份 DOM 的残留。
- **工具清单分块** = 「没有 `N 个工具调用 · 全部完成` 摘要钮」。单行块保持展开（M351 的折叠
  阈值 ≥2 行），恢复路径把每条 tool 记录挂到它所属的 assistant 消息上（`activeTools` 按消息
  边界重置），因此每块恰好一行、不产生摘要钮；修复前 `activeTools` 从不重置，两条记录会堆进
  第一条消息的块里、终态折叠成一行摘要钮——这条负向断言因此有区分度。
- **live 路径的折叠断言已随 M383 更新（2026-10-09，M393）**：M383 把 live 渲染从「一轮一个泡」
  改成「正文段 / 工具块按事件到达序交错」（`src/harness-panel.ts` 的 textSegments / sealedToolBlocks），
  本轮两次 `vault_create` 被中段正文（「撞名被拒了，换个新名字。」）隔开 ⇒ 两个**单行**块、都不折叠。
  旧断言（live 折叠为 `2 个工具调用 · 全部完成`）的前提是 M368 的「一轮一个泡」，随 M383 失效；
  改为断言「两条工具行都可见 + 不出现折叠摘要」，与恢复路径的 `not` 判据一致。**live 与恢复路径
  在「是否折叠」上因此不再有对比**（M368「live 同块 / recovery 分块」的对照退场）。折叠阈值
  （≥2 行）本身仍由 `collapseBlock` 守住，只是本场景这一轮造不出「连续 ≥2 行」的形状。
- **成功行/失败行的上屏形态（M406 更新）**：成功 = `vault_create harness-created.md`（工具徽章 +
  `humanizeToolArgs` 的人话化参数；参数 JSON 原文不再上屏，只留在 JSONL），失败（live）= ✕ 行 +
  尾注 `error · fs_already_exists: …`（后端 `summarize_result` 的失败形状原文作尾注），失败
  （恢复）= ✕ 行 + 尾注 `fs_already_exists: …`（`failureTextOf` 从记录 text 的输出 JSON 取
  `{code}: {message}` 全文，不带 `error · ` 前缀）。两串都由本场景的 mock 脚本唯一产出，不与别的场景串。
- **消息数** = AX 里 `AXButton (复制消息)` 的**行数**（= 元素数；每条消息一个复制钮：用户 1 +
  assistant 记录 3 = 4）。空正文记录若被渲染出来就会多一个消息元素（多一个复制钮 ⇒ 5 即红），
  这条判据同时是「空消息 MUST NOT 挂复制钮」的直接落点。**为什么不用「数 who 行文本」**：AX 会把
  who 行与其后的工具块 / 相邻正文合并进同一个 `AXStaticText`（合并形态形如
  `"vault_create harness-created.md Agent · 刚刚 撞名被拒了，换个新名字。"`），行数不随光秃头
  增加——那种形态在 AX 上无区分度，判据改落在复制钮数（元素级，不参与文本合并）。
- **中段正文也在**：三条 assistant 记录各自的正文都要能读到（首条「先试试撞名新建。」、中段
  「撞名被拒了，换个新名字。」、收尾「新建完成。」）——恢复若只重渲最后一条或把多条并成一条，
  这两条断言会红。

## 覆盖边界（如实登记，别读成「已覆盖」）

- **「空正文记录被跳过」这条判据的区分度在本场景里是结构性的，不是构造性的**：core 侧 M367
  之后不再落这类记录，套件现有 fixtures 里也没有「纯工具轮」（每条带工具调用的响应都带正文），
  因此**在当前流水线上造不出这个形状**。本场景判的是它的后果面（消息数 = 记录数、正文与工具行
  都在场）；「该不该渲染这条记录」的判据本体在 `tests/unit/harness-restore.test.ts` 的
  `restoredAssistantText` 单测上（空串 / 纯空白 / 缺 text / 非字符串 → 不渲染）。**MUST NOT**
  把本场景的 PASS 读成「旧快照防御已在真机验过」。
- **同上（本次改动面登记）**：把空正文跳过改成「渲染空消息」后，本场景的消息数会变红**仅当**那条
  空消息同时带了复制钮（修复前的代码正是无条件挂钮）；若改成「渲染空消息但不挂钮」，消息数照旧
  是 4、本场景看不出区别——那一形态的判据只在上面那份单测里（`restoredAssistantText` 返回 null
  即不建元素）。这条盲区写在场景里而不是留给读者猜。
- **不判 webview 重载**：套件没有触发前端整页重载的动作（`restart` 会连 Rust 进程一起重启，
  core 的内存态会话随之清空，恢复出来是空会话）。本场景用「切 vault 再切回」这一条同源的
  恢复通道（面板随存储重建 + `vaultChanged` 重拉快照），它与重载走的是同一个 `restoreSnapshot`。
- **会话键的拼写依赖（本场景的现场约束）**：首次提问与切回都必须走注册表路径打开 A（见步骤里
  的说明）。若某次运行里 A 在启动恢复阶段就被提问、或切换路径与注册表路径拼写不一致，恢复出来
  的会是**另一个（空）会话**——那时不是渲染缺陷，是会话键不一致（场景 78 的覆盖边界里有这条
  的原卷）。这条约束不靠断言兜，靠步骤设计：两次打开都是 ⌘O 的注册表行。
- **只读／写类工具的权限闸不在本场景判**：`allow: [vault_create]` 是为了免掉批准闸（本场景判
  的是恢复渲染），闸本身的判据在场景 72/73/75。

## 环境与副作用

- 两个合成 vault（`/tmp/lumir-m102-acceptance` 与 `-b`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault
  只读。mock 的 `vault_create` 会真的往验收 vault 里写 `harness-created.md`（套件每场景重置
  vault，不影响别的场景）。
- 只切 vault、只读 AX；1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
