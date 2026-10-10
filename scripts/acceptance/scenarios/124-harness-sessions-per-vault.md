---
# M433（change harness-sessions-per-vault）：会话留存从平铺改为**按 vault 分目录**
# （`sessions/<vault 稳定 id>/<session_id>.jsonl`）。本场景是该布局的真机判据：
#   ① 两个 vault 各落各目录（目录名 = vault 注册表 id）；
#   ② 会话浮层 / 会话名钮只反映**当前 vault** 的会话（另一 vault 的提问不出现）；
#   ③ 产品只写新布局——`sessions/` 根下不落平铺文件。
# 归位（存量平铺文件搬进 vault 目录）由一次性脚本负责，见场景 125（本场景不预置存量）。
id: "124-harness-sessions-per-vault"
item: 124
title: 会话留存按 vault 分目录：两 vault 各落各目录（目录名 = 注册表 id），浮层只见当前 vault 的会话，根下零平铺
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  # 两个 vault 都预先注册（`$vault2` 的记号解析见套件 README）。**id 是场景的判据**——
  # 会话目录名取注册表 id，所以 `acc-a` / `acc-b` 是断言里能写死的确定值（产品自己生成的
  # id 形如 `vault-<pid>-<n>`，场景侧无从预知）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: ⌘⇧A 打开 harness pane（当前 vault = A）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: transcript 是空态提示（A 还没有会话）
        ax: { has: "与当前文档对话" }

  - name: 在 A 里输入提问标记（两串标记各只由本场景注入）
    do: keys
    keys: ["p", "v", "a", "u", "l", "t", "a", "l", "p", "h", "a"]
    expect:
      - label: 标记落在 composer 里（注入落地）
        ax: { has: "pvaultalpha" }

  - name: 发送——A 的回合跑起来
    do: key
    key: enter

  - name: 等 A 的回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: A 的回答渲染（回合真实完成）
        ax: { has: "验收回答：上下文已收到。" }
      - label: A 的会话落在 `sessions/acc-a/`（目录名 = A 的 vault 稳定 id）
        file: { path: "env:harness/sessions/acc-a/*.jsonl", has: '"kind":"session_open"' }
      - label: 该留存里是 A 的提问（新布局的落点正确、不是别的目录）
        file: { path: "env:harness/sessions/acc-a/*.jsonl", has: "pvaultalpha" }
      - label: 会话名钮落到 A 的会话（A 侧列举范围正确）
        ax: { has: "/AXPopUpButton \\(pvaultalpha/" }
      - label: B 的目录此刻还不存在任何留存（另一 vault 不被写入）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 1 }
      - label: sessions/ 根下不落平铺文件（新布局是唯一布局）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 0 }
      - shot: 01-A-回合完成

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton；标题栏会话名 = 当前会话的提问）
    do: click
    target: { role: AXPopUpButton, name: "pvaultalpha" }

  - name: 等历史清单出现（清单现拉现建——harness_list_sessions 往返）
    do: waitFor
    waitFor:
      has: ["/删除该会话/"]
    timeoutMs: 15000
    expect:
      - label: 会话名钮落到 A 的会话（标题栏会话名取当前会话的首条用户消息）
        ax: { has: "/AXPopUpButton \\(pvaultalpha/" }
      - label: 清单恰一行——浮层列的是本 vault 目录（sessions/acc-a/）里的会话，读错布局（仍扫平铺根 / 扫全部 vault 目录）会 0 行或多行，双向都不成立
        ax: { count: { pattern: "/AXButton \\(删除该会话\\)/", exact: 1 } }
      - shot: 02-A-会话浮层

  - name: 关闭浮层（Escape 由标题栏段上的处理器收，不落到面板层）
    do: key
    key: escape

  - name: ⌘O 打开 vault 列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }

  - name: 点 B 行（切到第二个 vault）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等切到 B 的装载跑完（状态驱动，不用 settle 猜装载时长）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  - name: 在 B 里打开一个文档（其余 harness 场景同形的前置：有打开文档才有上下文 chip；
      也让 B 侧走一遍最常见的用户现场——切 vault 后 pane 的标题栏段另有已知缺口，见文末覆盖边界）
    do: open
    file: beta.md
    marker: "第二个 vault 的笔记"
    expect:
      - label: B 的文档打开渲染（正观测）
        ax: { has: "第二个 vault 的笔记" }

  - name: ⌘⇧A 在 B 里打开面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板在位（正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: transcript 回到空态提示（B 还没有会话——判据「A 的内容没串过来」的正观测）
        ax: { has: "与当前文档对话" }
      - label: A 的提问没有留在 B 的任何界面里（会话名钮 / 浮层都不该有它）
        ax: { not: "pvaultalpha" }
      - shot: 02-B-空态

  - name: 在 B 里输入提问标记
    do: keys
    keys: ["p", "v", "a", "u", "l", "t", "b", "e", "t", "a"]
    expect:
      - label: 标记落在 composer 里（注入落地）
        ax: { has: "pvaultbeta" }

  - name: 发送——B 的回合跑起来
    do: key
    key: enter

  - name: 等 B 的回答到达
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: B 的回答渲染（回合真实完成）
        ax: { has: "验收回答：上下文已收到。" }
      - label: B 的会话落在 `sessions/acc-b/`（与 A 分置两个目录）
        file: { path: "env:harness/sessions/acc-b/*.jsonl", has: "pvaultbeta" }
      - label: A 的留存里没有 B 的提问（两 vault 的目录内容互不污染）
        file: { path: "env:harness/sessions/acc-a/*.jsonl", not: "pvaultbeta" }
      - label: B 的留存里没有 A 的提问（同上，反方向）
        file: { path: "env:harness/sessions/acc-b/*.jsonl", not: "pvaultalpha" }
      - label: 面板仍在场（B 的回合就在这块 pane 里跑完——正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 浮层 / 界面里仍看不到 A 的会话（跨 vault 不串台）
        ax: { not: "pvaultalpha" }
      - label: 两个 vault 目录各恰一份留存
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 根下仍零平铺（产品只写新布局）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", recursive: false, exact: 0 }
      - shot: 03-B-回合完成
---

# 124-harness-sessions-per-vault —— 会话留存按 vault 分目录（change harness-sessions-per-vault）

## 本场景在验什么

spec「会话本地留存」MODIFIED 的布局条款：会话落 `<config_dir>/harness/sessions/<vault 稳定 id>/`
（目录名 = **vault 注册表 id**，与 `vault-sessions/<id>.json`、`reading-positions/<id>.json`
同一份身份），列举 / 恢复 / 删除只读本 vault 的目录；`sessions/` 根下的平铺布局是**上一代的
唯一布局、产品运行时零迁移代码、不双读**。对应的 spec 场景是「留存落盘」与「按 vault 分置与
列举范围」。

三条判据与证据：

1. **分置**：A 的提问落在 `sessions/acc-a/`、B 的落在 `sessions/acc-b/`（两个目录名都是场景
   预置的注册表 id）——四个 file 断言两正两负，同时钉住「落对目录」与「不落对方的目录」。
2. **列举范围**：在 A 打开会话浮层——清单恰一行（`删除该会话` 钮 `exact: 1`），且它由
   `harness_list_sessions` 现拉（浮层空清单不开，所以「清单恰一行」同时是「读到了新布局的
   `sessions/acc-a/`」的判据：读错布局会 0 行、读太宽会多行，双向都不成立）；切到 B 之后
   `pvaultalpha` 在 B 侧**整棵 AX 树里都不出现**（B 的 panel 空态 + A 的内容不串台）。
3. **单一布局**：`sessions/` 根下 `*.jsonl` **恒为 0**（`glob` 的 `recursive: false` 形态——
   递归统计在分目录之后做不到这件事，两种口径各自表达）。

## 判据为什么这样写

- **目录名写死 `acc-a` / `acc-b` 是可靠的**：`reconcile_vault` 按规范化路径命中预置注册项即
  复用它的 id（`workspace_readings` 的同名判据由 Rust 侧集成测试覆盖），产品只在「未注册路径」
  时才自己生成 `vault-<pid>-<n>`；本场景的两个 vault 都在 `seed.registry` 里。
- **两串标记都是本场景独有**：`pvaultalpha` / `pvaultbeta` 只由本场景注入，跨 vault 的负向断言
  因此不会撞上别的文案。
- **`recursive: false` 与默认递归两条都用**：前者判「根下零平铺」，后者判「两个 vault 目录各
  一份」——一条递归统计同时数到两者，分不开；这是 M433 给 `glob` 断言加的选项。
- **A 侧先判 B 目录为空**（`glob … exact: 1`）：证明「另一 vault 不被写入」不是靠 B 的会话
  恰好没写出来，而是在 A 的整轮里根本没有第二份留存。
- **A 侧的浮层判据是「浮层恰一行」而不是「浮层里有 pvaultalpha」**：会话名也出现在标题栏的
  会话名钮上，`has: "pvaultalpha"` 在没有浮层时同样成立（REVIEW.md 第 1 条：判据要有区分度）；
  行数（`删除该会话` 钮个数）才只可能来自 `harness_list_sessions` 的返回。
- **B 侧先开一个文档再开面板**：与其余 harness 场景同形（有打开文档才有上下文 chip），
  也让 B 的 pane 处在最常见的用户现场。

## 覆盖边界（如实记录）

- **B 侧（切 vault 后新开的 pane）未判标题栏会话名钮 / 会话浮层**：实测两次（B 侧有/无打开
  文档各一次）该标题栏段（`.lumir-hp-seg`：会话名钮 + 新会话钮）在 AX 树与截图里都不在场，
  而面板本体（transcript / composer / 模型与权限 chip）在场且功能正常——即**切 vault 后新开
  的 harness pane 拿不到那条标题栏段**，会话历史浮层在那个 vault 里没有 UI 入口（候选缺陷，
  与本次布局改动无关：本 change 的 diff 一字未动 `src/`，已作为 finding 上报 tower；现场见
  本场景两次失败运行的 AX dump 与截图）。因此「浮层只见其一」的**跨 vault 方向**在本场景以
  磁盘断言承担（A/B 两个目录各恰一份、互不含对方的提问）+ Rust 侧集成测试
  （`sessions_are_partitioned_per_vault_*` 的列举范围与归属过滤）。
- **不判「切回 A 看得到自己的会话」**：与场景 78 同一处已知边界（同一 vault 的两种路径拼写
  ⇒ 两个会话，M312 在办）。本场景只判**分目录落点与列举范围**，不判切回后的会话可见性。
- **不判恢复 / 删除的跨 vault 行为**：那两条在 id 目录内命中的判据由 Rust 侧集成测试
  （`src-tauri/tests/session_recording.rs` 的 `sessions_are_partitioned_per_vault_*`）逐条覆盖；
  真机侧它们的入口都要经过浮层，代价高、与本 change 的布局条款不是同一件事。
- **不判「存量平铺文件的一次性归位」**：那是场景 125 的事。
