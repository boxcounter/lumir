---
id: "225-app-splash-screen"
item: 225
tier: full
title: 启动态：大 vault 冷启的首帧 / 撤下读数，与未打开终态的撤下原因
# 合成大 vault（2142 文件 / 426 目录，与场景 67 同一生成器）：把恢复段撑到能被读数看见的
# 量级。树本身仍在就绪门之后才可断言（见文末「已知边界」）。
seed:
  bulkVault: true
steps:
  - name: 大 vault 冷启后树就绪（启动态已撤下，阶段行不残留）
    do: settle
    expect:
      - label: 树里有验收 vault 的根级文件行（恢复成功、树已可交互）
        ax: { has: "plain.md" }
      - label: 阶段行走后不残留（D95 只在启动态期间出现）
        ax: { not: "正在恢复上次打开的 vault" }
      - shot: 01-冷启终态

  - name: 等两条启动态读数落盘
    do: waitForFile
    waitForFile:
      path: "env:logs/*.jsonl"
      jsonl: { event: startup_surface, phase: dismissed, reason: tree_ready }
    timeoutMs: 20000
    expect:
      - label: 撤下读数在场且原因为 tree_ready（终点 = 树装载完成）
        file: { path: "env:logs/*.jsonl", jsonl: { event: startup_surface, phase: dismissed, reason: tree_ready } }
      - label: 首帧读数在场（启动层在装载主模块之前交付了首个内容帧）
        file: { path: "env:logs/*.jsonl", jsonl: { event: startup_surface, phase: first_frame } }
      # 顺序判据：两条读数各自在场不足以证明「首帧先于撤下」——跨行匹配要求 first_frame
      # 出现在 dismissed 之前（反序时本正则不命中，见同目录下场景文档的判别力说明）。
      - label: 首帧读数先于撤下读数落盘
        file: { path: "env:logs/*.jsonl", has: '/"phase":"first_frame"[\s\S]*"phase":"dismissed","reason":"tree_ready"/' }
      # 信息卫生（机器兜底由 Rust 白名单提供，这里是端到端复核）：读数的载荷不含 vault 路径。
      - label: 启动态读数不含验收 vault 的路径
        file: { path: "env:logs/*.jsonl", not: '/"event":"startup_surface"[^\n]*lumir-m102-acceptance/' }

  - name: 把 last_vault 指向不存在的目录后重启（未打开终态）
    do: configWrite
    lastVault: /tmp/lumir-m645-no-such-vault
    requireVault: false
    expect:
      - label: 进入未打开空态并给出失效原因（人话提示，与既有实现逐字一致）
        ax: { has: "上次打开的 vault 已不可用" }
      - label: 「打开 vault」入口可用（按钮在 AX 里可见）
        ax: { has: "/AXButton[^\\n]*打开 vault/" }
      - label: 阶段行不残留（启动态随未打开终态撤下）
        ax: { not: "正在恢复上次打开的 vault" }
      - label: 撤下原因为 no_vault（与 tree_ready 可区分）
        file: { path: "env:logs/*.jsonl", jsonl: { event: startup_surface, phase: dismissed, reason: no_vault } }
---

# 225-app-splash-screen —— 启动态的两条诊断读数与终态撤下（M645，change app-splash-screen）

## 本场景在验什么

change `app-splash-screen` 把启动期的呈现面换成**启动态**（骨架 + 产品标记 + 恢复中的阶段行，
`src/boot.ts` / `src/startup-surface.ts`），并在「首个内容帧」与「撤下」两个时刻各落一条
`startup_surface` 诊断读数。本场景在真实 WKWebView 下判三件事：

1. **首帧先于撤下，撤下原因是 tree_ready**：合成大 vault（恢复段是这一端唯一有量级的活）冷启，
   日志里 `first_frame` 必须先于 `dismissed(reason=tree_ready)` 出现——顺序用跨行正则判，
   两条各自在场不足以证明顺序（反序时正则不命中）。
2. **终态撤下可区分**：`last_vault` 失效时撤下原因为 `no_vault`，界面落到既有未打开空态，
   阶段行不残留。
3. **载荷无敏感信息**：读数行里没有验收 vault 的路径（白名单在 Rust 侧是机制化判据——只放
   阶段名 / 撤下原因 / 毫秒数 / unix 毫秒时间戳；本场景是端到端复核）。

## 断言口径

- **判据来源是诊断日志，不是 AX 时序**：启动态在场的那一小段（`show()` → 树装载完成）**在就绪门
  之前**，套件的任何步骤都要等就绪门（`waitForReady`：树里有 `.md` 行或空态）才开跑——而就绪
  的那一刻正是启动态撤下的那一刻（同一个 `tree.setVault`）。因此「启动态在屏上长什么样」不归
  本场景，归视觉场景 `tests/visual/scenes/m645-startup-surface.spec.ts`（冻结恢复态、三主题首帧、
  几何与零动画断言）。本场景判的是**两端**：它确实出现过（首帧读数）、它确实撤下了（撤下读数 +
  阶段行不在 AX 树里）。
- **`not 正在恢复上次打开的 vault` 的配对**：这是一条负向断言，配对的正观测是上面两条读数
  （首帧 + 撤下）——若启动态从未挂载，首帧读数不会存在，本场景在前一步就红（REVIEW.md
  「读不到当成空」条的防线：负向断言必须有正观测配对）。
- **路径否定的作用域**：`not` 的正则用 `[^\n]*` 锚在同一行内，只否「启动态读数那一行含 vault
  路径」，不否整个日志文件（`save_conflict` 这类事件本来就带 vault 相对路径，那是既有口径）。

## 已知边界（如实登记，不包装成覆盖）

- **启动态在场期间的交互（窗口拖动、启动态内「打开 vault」入口触发的让位）不在真机层判**：
  就绪门之前没有可执行步骤的通道（见上「判据来源」）。这两条落在视觉层：拖拽区靠
  `data-tauri-drag-region` 的结构断言 + REVIEW.md『标题栏 mousedown preventDefault 打断拖拽』条
  的既有防线（启动面容器零 `mousedown`）；让位链路由 `startup-restore.spec.ts` 的第 4 条
  （经 `.startup-open` 点击打开另一个 vault）在 chromium 层判。真机拖拽在启动态期间的实测
  留作手感项，不给阈值。
- **安全阀（10s 超时）路径未在本场景合成**：套件没有「让恢复永远不返回」的构造手段（合成
  vault 的恢复总有界；不可达网络卷不在跑批环境内）。该分支由单测
  `tests/unit/startup-gate.test.ts`（到点判 `timeout`、差一毫秒继续）与启动面自身的计时器实现
  钉住；真机证据的缺位如实登记，不冒充已覆盖。
- **`first_frame` 的 `ms` 是「交出了渲染机会」的时刻**，不是 KVP 意义上的绘制完成时刻
  （窗口不可见时 WebKit 可能不派发渲染帧，启动层用双 rAF + 200ms 兜底）。它用于与
  `LUMIR_READY` 的 `ts_unix_ms` 相减得「上屏 → 启动层首帧」的量级读数，不作门禁。

## 环境与副作用

- 合成大 vault 生成在验收 vault（`/tmp/lumir-m102-acceptance`），隔离 `XDG_CONFIG_HOME`；
  1420 全程不碰，实例走 `LUMIR_ACCEPTANCE_PORT`（默认 1430）。
- 第二步把 `last_vault` 指向 `/tmp/lumir-m645-no-such-vault`（不存在的目录），不影响任何真实
  配置或 vault。
