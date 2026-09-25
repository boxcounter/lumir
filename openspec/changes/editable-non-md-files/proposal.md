# Proposal: 非 md 文本文件可编辑（editable code 模式）

- Change ID: editable-non-md-files
- 日期: 2026-09-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话（2026-09-25）：「支持编辑其他格式文件。目前似乎只能编辑 Markdown 文件。」

现状：`.md`/`.markdown` 之外的一切已打开文件一律以**只读** code 模式打开
（`src/editor.ts:1056-1059` 的 `modeForPath` + `src/editor.ts:1350-1354` 的视图层只读合同）。
只读不是终态设计，而是 M130 的**堵漏裁决**：当时未收录扩展的文件会回落配置默认
（出厂 md）——能改、能 dirty，却没有磁盘 revision 可保存，Cmd+S 静默失败，dirty 又锁死
切换与退出（保存死态，M129 实证）。Alex 裁决 D4「非 md 即只读」封死了这条陷阱，同时把
「方向 B：让非 md 文本文件可保存」明确列为 Non-goal，理由原文：「CAS / 自动保存 / 崩溃
备份 / 退出守卫全链路都要按非 md 重新验证……代价远超本次堵漏目标」
（`openspec/changes/archive/2026-09-13-non-md-readonly-open/proposal.md:26-31`）。

本 change 翻开这条历史裁决。逐条复审（全部 file:line 锚点见 design.md §1）的结论：

1. **当初挡路的全链路重验证，今天仍是义务，但验证面已大幅收窄**。M124/M127 之后保存链路
   已收敛进 `src/save-controller.ts`，按路径键控、模式无关；逐环节复审（design §3）定位
   出全部 md-only 门共四处（初稿只查到两处，评审 r1 实证补出另外两处）：
   `src/main.ts:418-420` 的 revision 登记门、`src/save-controller.ts:233-237` 的
   `saveBaseline` mode 闸（不放宽则 code 会话的保存/强制保存/崩溃备份全部失效）、
   `src/editor.ts:1417` 的 changeFilter dispatch 闸（不放宽则只翻 editability 会得到
   假可编辑编辑器——contenteditable 在场但按键被吞）、`src-tauri/src/fs_io.rs:348-353`
   的 `save_markdown` 扩展名守卫。除这四条门之外，CAS、自动保存、冲突
   恢复、崩溃备份、外部修改重载、退出守卫全部不携带 md 假设。
2. **live preview 只服务 md 这条仍然成立**，但它只约束编辑形态（code 模式不引入装饰层），
   不构成「不可编辑」的理由。
3. **语法高亮管线与可编辑性正交**（M120 的 `StreamLanguage` 增量解析天然支持编辑期更新），
   code 模式的着色、行号、搜索、大纲在可编辑后无需重做。

## What Changes

以下按裁决点推荐项起草；裁决改备选则按备选改写 delta 与 tasks。

1. **非 md 文本文件以可编辑 code 模式打开**（裁决点 D1 推荐项 = 注册表全量文本类）：
   扩展名注册表（`src/preview/attachments.ts`，单一事实源）中 `fileClass` 为 `code` 或
   `text` 的文件——已知代码扩展、未收录扩展、dotfile、basename 无点的 `LICENSE`/`Makefile`
   ——打开后可编辑：纯文本编辑 + 既有语法高亮（有语言包则高亮、无则纯文本），行号、
   搜索、大纲、折行等 code 模式既有能力不变。image / binary 类维持现状（不进编辑器，
   二进制给「暂不支持预览」提示）。（delta：`editor-live-preview` REMOVED+ADDED+MODIFIED；
   `file-tree` REMOVED+ADDED——scenario 不可更名的工具链约束见 Impact 节）
2. **可编辑性从「按模式」改为「按文件类」**：现状 `editable(false)`/`readOnly(true)` 硬绑
   `mode !== "md"`（`src/editor.ts:1350-1354`），且 dispatch 层的 `changeFilter`
   （`src/editor.ts:1417`）拦截非 md 会话的一切 docChanged 事务——两处都必须按会话
   「可编辑」标志放宽，只翻前者会得到假可编辑编辑器（design §2.2）。改为按会话承载
   标志，md 与注册表文本类文件可编辑，`aria-readonly` 等无障碍属性同步。`modeForPath`
   的 md/code 两模式裁决本身不变（M130 方向 A 的模式选择语义保留，只解除只读）。
3. **保存链路全量复用**（裁决点 D3 推荐项）：可编辑文本类文件打开即登记磁盘 revision
   （`src/main.ts:418-420` 的 `kind === "md"` 门放宽），保存基准闸 `saveBaseline`
   （`src/save-controller.ts:233-237` 的 `mode !== "md"` 判）同步放宽为按可编辑标志
   （design §3.2）；此后 Cmd+S、自动保存、CAS 冲突
   恢复、崩溃备份、外部修改重载、退出守卫与 md 走同一条链路。后端 `save_markdown` 的
   md-only 守卫（`src-tauri/src/fs_io.rs:348-353`）放宽为「拒绝 image/binary 扩展」
   （design §3.7）。「另存为新文件」逃生口泛化保留原扩展名（design §3.8）。
   （delta：`fs-io` MODIFIED ×3）
4. **护栏维持既有层**（裁决点 D4 推荐项）：二进制按注册表分流不入编辑器、非 UTF-8 打开
   即拒（`fs_invalid_utf8`）、50MB 读取硬上限（`ATTACHMENT_MAX_BYTES`）均不变；不新增
   超大文件只读阈值，实现期在真机对产品端点复测打开与编辑性能（perf-measurement 大口径），
   不达标再回来加阈值。

## 须提请 Alex 节点 1 裁决的选项

四项都给了推荐项，delta 与 tasks 已按推荐项起草；裁决改备选则按备选改写。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **可编辑范围**：注册表全量文本类，还是白名单？ | **注册表全量文本类**（`code` + `text`：已知代码扩展、未收录扩展、dotfile、无扩展名文件）——M130 保存死态的根因就是分类分裂（两套扩展名集合差集），白名单重新引入同一类陷阱；注册表已是单一事实源；未知二进制由打开时的 `fs_invalid_utf8` 兜底拒读，不靠扩展名猜 | 白名单（txt/json/yaml/toml + 有语言包的代码扩展，其余维持只读） | 白名单的收益是编辑面可控、验证面更小；代价是 `.log`/`.csv`/`LICENSE` 这类「目前只能编辑 md」抱怨的高发面仍然只读，且每条边界都要新文案与新测试 |
| D2 | **编辑形态**：可编辑 code 模式，还是非 md 也套 live preview？ | **可编辑 code 模式**（纯文本编辑 + 既有 StreamLanguage 高亮）——live preview 装饰层是 md 语义（`editor-live-preview` spec「live preview 装饰层」条款 md-only），代码文件没有可装饰的对象 | 非 md 也套 live preview | 备选零收益且违反 spec 口径，列入仅为显式否决（design §6 V2） |
| D3 | **保存链路**：全量复用 md 的保存冲突防护，还是手动保存-only？ | **全量复用**——逐环节复审（design §3）证明链路除四条窄门外已模式无关（评审 r1 补全门清单：revision 登记、`saveBaseline` mode 闸、changeFilter、后端守卫）；自动保存/冲突恢复/崩溃备份对非 md 文本（配置、脚本、笔记附件）的价值不低于 md | 手动保存-only（非 md 不进自动保存与崩溃备份） | 备选的代价：在模式无关的链路里新设模式分支，复杂度更高、防护更弱；收益只剩「少验几条路径」（design §6 V3） |
| D4 | **护栏**：维持既有层，还是新增超大文件只读阈值？ | **维持既有层**（注册表分流 + UTF-8 校验 + 50MB 硬上限），不新增阈值；实现期真机 perf 复测，不达标再回来加 | 超过阈值（如 1MB，对齐打开性能合同）的文本文件保持只读 | 备选的收益是性能确定性；代价是没有实测证据就先立一条用户可感的功能边界——1MB 的 `.log` 只读而 0.9MB 可编辑，比统一可编辑更难解释 |

## Non-goals

- **不引入非 md 的 live preview / 装饰层**：编辑形态就是纯文本 code 模式（D2）。
- **不做搜索面板替换控件**：code 模式的搜索维持只读查询（现状口径，是否加替换是独立议题）。
- **不扩语言覆盖**：不为未收录扩展新接 legacy mode（沿用 M130 Non-goal 口径）。
- **不改 `editor.mode` 配置项语义**：它仍只决定无文件上下文文档（空态/新建）的模式。
- **不改 image/binary 的打开行为**：不引入图片编辑或二进制查看器。
- **不动着色管线与语言注册表结构**：`code.ts` 的 `LANGUAGES`、`TOKEN_GROUPS` 单一来源
  口径不变（M152）；大纲/变量高亮的内容键缓存口径不变（spec 已预见可编辑，design §4.4）。
- **不做 vault 外文件的编辑**：仍只有 vault 内文件可打开。

## Impact

- **影响的 specs**：`editor-live-preview`（REMOVED「单内核双模式落地」+ ADDED
  「单内核双模式与可编辑性落地」+ MODIFIED「模式配置来源」——行为翻转的 scenario
  「非 md 文本文件只读打开」不可在 MODIFIED 中删除/更名（openspec 工具链约束），
  只能随宿主 requirement 整条 REMOVED + 新名 ADDED，living spec 他处对旧名的引用
  归档时改指，见 tasks §6.4）、`file-tree`（REMOVED「点击打开文件」+ ADDED
  「点击打开文件与可编辑性裁决」，同约束）、`fs-io`（MODIFIED「文档保存与冲突恢复」
  「崩溃备份与恢复入口」「不可保存文档的保存反馈」）。
- **影响的代码/系统**（实现 mission 照 design 锚点施工）：
  - `src/editor.ts`：可编辑性按会话/文件类拆分（:1056-1059、:1346-1357、:1723），
    含 dispatch 层 changeFilter 闸放宽（:1413-1417，评审 r1 P1-2）；
  - `src/main.ts`：revision 登记门放宽（:418-420）；
  - `src/save-controller.ts`：`saveBaseline` mode 闸放宽为按可编辑标志（:233-237，
    评审 r1 P1-1）、M130 兜底反馈文案更新（:312-322）、`saveAsNewFile` 泛化
    保留原扩展名（:469-498）；
  - `src-tauri/src/fs_io.rs`：`save_markdown` 守卫放宽为拒绝清单（:342-353）+ 单测
    对账（:924-933）；`src-tauri/src/link_graph.rs` 或新增通用 create 命令支撑另存泛化
    （design §3.8）；
  - `tests/visual/scenes/m130-text-open-trap.spec.ts` 等：只读断言矩阵改写为可编辑矩阵
    （反向断言先红纪律照旧）；
  - `scripts/acceptance/scenarios/`：新增真机场景 **41**（编辑+保存+冲突防护复用）与
    **42**（护栏矩阵）——编号已与 M229/M230 协调：现有最大 36，M225–M228 提案占 37–39，
    M229/M230 占 40（两家撞号待其自行收束，已广播），本 change 取 41/42。
- **性能**：编辑态高亮走 `StreamLanguage` 增量解析（既有依赖，零新增）；打开路径性能合同
  （1MB <100ms，ADR 0002 §6）不因非 md 放宽；实现期真机复测义务见 D4 与 tasks。
- **关联约束**：ADR 0002 §2（单内核双模式）、§6（性能合同）；ADR 0003 §3 铁律（装饰不改
  源码——code 模式无装饰层，天然满足）；REVIEW.md 第 8 条（后端拒绝清单与 TS 注册表的
  双表防漂移，design §3.7 给对账机制）。
- **历史裁决的关系**：本 change 翻转 M130 D4 的「只读」部分，**保留**其模式裁决语义
  （非 md 不走 md 模式、不回落配置默认）与兜底反馈条款（无落盘能力的 dirty 文档 Cmd+S
  MUST 给可见反馈——触发面收窄后仍作为防再犯兜底保留，见 fs-io delta）。
