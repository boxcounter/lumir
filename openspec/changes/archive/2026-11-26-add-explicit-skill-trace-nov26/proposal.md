# Proposal: 显式 Skill 留下可见痕迹

- Change ID: `add-explicit-skill-trace-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 节点 1（提案评审）**已批准**（2026-11-26）。Alex 裁决原话：对「显式 Skill 留下可见痕迹」回复
> 「采纳」。批准范围：每个显式选择的 Skill 在 harness pane 显示类似工具调用的一条记录；能看到
> 名称、已加载或失败原因；只显示痕迹不显示 Skill 正文；复用工具行折叠与视觉体系；切换会话 /
> 恢复历史后痕迹仍存在；不改变 Skill 权限、加载、内容注入逻辑；自动 `skill_load` 既有表现保持
> 不变。

> 节点 2（归档评审）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md`「节点 2 五要件」），
> 逐要件事实见本文末「归档记录」。

## Why

用户显式选择 Skill 后，面板今天**没有一条可核对的记录**：

- 成功加载只把带 `lumir_skill` 标记的正文 part 追加进用户消息
  （`src-tauri/src/harness/turn.rs` 的 `explicit_skill_parts`），而面板投影
  （`panel_text_of_content`）有意跳过该 part——消息气泡里只剩用户原文，看不出选中的 Skill 是否
  真的加载了。
- 部分失败（权限拒绝、元数据非法、禁手动）只在 **live** 发一对 `tool_call` 事件并写内存面板
  （`emit_explicit_skill_error`），不留任何可恢复载体；grammar 不合、发现不到、文件不可读、无正文
  等失败当前连 live 痕迹都没有，直接静默跳过。
- 恢复 / 切换会话时面板从 `llm_request.messages` 重建
  （`restored_panel_messages`），上述两类痕迹都不在重建面里——切走再回来，痕迹全部消失。

结果是用户无法回答「我选的 Skill 加载成功了吗、失败是为什么」。这与「显式选择 = 用户按键确认
的显式调用」（`openspec/specs/harness/spec.md`「Skill 的混合调用、入口策略与候选接受」）的
可核对性不匹配。

## What Changes

1. **`harness` 新增 requirement「显式 Skill 加载痕迹」**
   - 每个显式选择在面板留一条与工具调用同形的痕迹行（工具名 `explicit_skill`，与模型自主的
     `skill_load` 区分），成功呈「已加载」，失败呈失败终态并给出具体原因。
   - 失败面补齐：名字不合 grammar、不存在、SKILL.md 缺失 / 不可读 / 超限、加载结果无正文、
     调用元数据非法、禁手动、权限拒绝，全部留痕，不再静默。
   - 痕迹只含名称、终态、错误码与人话原因；SKILL.md 正文与目录内其他文件内容 MUST NOT 进入
     面板、辅助技术树或痕迹载体。
2. **痕迹的可恢复载体**：痕迹随该用户消息进入会话 `input` / `llm_request.messages` 的本地字段
   `lumir_skill_trace`（`{name,status,code?,message?,ts}` 数组），在 provider wire 展开时与
   `lumir_skill` 一并剥除（模型不可见）。恢复路径从该字段重建同一批工具行；live 与恢复不重复、
   重试不重算。
3. **不变量**：权限判定、执行期正文加载器、正文注入 part、面板正文投影、自动命名素材与自动
   `skill_load` 的工具行 / 结果回送全部保持既有语义。

## Non-goals

- 不向模型注册新工具（`explicit_skill` 只是面板痕迹的呈现名）、不改变 `skill_load` 的参数 / 结果合同与
  权限判定顺序，不扩大权限。
- 不把 Skill 正文、路径、frontmatter 原文放进痕迹行、面板或 AX。
- 不改变自动 `skill_load` 的既有工具行、折叠与结果回送。
- 不新增配置开关、不新增面板筛选 / 搜索 / 导出能力。
- 不改变工具行折叠与视觉体系（痕迹行只是同一套行件的一个消费者）。
- 不在本 change 内处理自动压缩后的历史（压缩换新逻辑会话，旧痕迹与既有工具行同口径地不承诺
  保留）。

## Impact

- 影响的 specs：`harness`（新增 requirement）。
- 影响的代码/系统：`src-tauri/src/harness/turn.rs`（显式加载管线与痕迹产出）、
  `src-tauri/src/harness/attachments.rs`（wire 剥离）、`src-tauri/src/harness.rs`（恢复重建）、
  `src/harness-panel.ts`（`explicit_skill` 参数格人话化）、对应 Rust / 前端单测与验收场景 726。
- 关联约束：不触及性能合同与「不改写源文件」铁律；不新增持久化文件，痕迹随既有会话留存
  （JSONL）走。

## 归档记录

### 归档前（节点 2 五要件）

1. **方案已批准**：节点 1 为 Alex 2026-11-26 对「显式 Skill 留下可见痕迹」回复「采纳」，范围见
   本文头部；实现期（含返修 r1 的 P1-1 / P2-1 / P2-2 / P2-3 收口）未注册新工具、未改权限判定、
   未把 Skill 正文写入痕迹载体，未扩大范围。
2. **独立评审**：K3 独立复审 **clean / merge**（P1 / P2 / P3 均为 0），绑定 tip
   `b7a63fc5f6351e1142a8660e0bb2776935889a36`，verdict
   `.local/reviews/add-explicit-skill-trace-nov26/k3-verdict.md`。该 tip 之后的 master 增量只有
   合并提交 `edf336c9` 与 test-only 提交（`92008fdb` 单测类型收窄、`58ab5fd1` / `f5e9205e`
   验收场景对齐）；`9cf5d75f..HEAD` 对 `src/**` 与 `src-tauri/**` 零改动，合并冲突的逐文件处置
   见 `.local/missions/harness-ux-integration-nov26/README.md`。verdict 把「真机 726 + 77、完整
   视觉、完整 gate 未跑」列为未完成验证，本节第 4 条补齐。
3. **tasks 完成**：`tasks.md` 全勾（6.6 记录真机结果），无放弃项。
4. **门禁与真机证据**：
   - quick：`GATE RESULT: 13/13 PASS（SKIP 0）`，日志
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/harness-ux-integration-nov26/gate-quick-release-0.19.0-r2.log`；
   - 集成测试：Rust 1382 passed / 0 failed / 6 ignored；前端单测 2075 passed；相关视觉结构 135
     passed / 1 skipped；
   - 首轮完整 visual：`GATE RESULT: 14/15 PASS（SKIP 0）`，唯一 FAIL 是当时未修的 `tsc-unit`
     （既有问题，`92008fdb` 修掉），`visual-regression` PASS（1287s）；
   - 最终完整 visual：14 个 quick 项全 PASS，`visual-regression` 1839 passed / 1 failed（唯一失败
     是既有 IME 低频定时用例，与本批改动面无交集），该用例双引擎复跑 2/2 PASS（日志见
     `.local/missions/harness-ux-integration-nov26/gate-visual-release-0.19.0-final.log` 与
     `ime-low-frequency-release-recheck.log`）；**不声称完整 gate 15/15**；
   - 真机：77 **PASS**（8 断言，首轮）与 726 **r2 PASS**（51 断言、36.5s）；726 首轮 FAIL
     （51 断言 / 2 失）经场景期望对齐真实行为后转绿（`58ab5fd1`，产品代码零改动）。证据
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-26-release-0.19.0/` 与
     `-r2/`。
5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（扫过 14 份 delta / 17 条
   MODIFIED / 262 段 / 无静默丢段；归档队列 1 项已完成 change 有唯一条目）；`validate --all
   --strict` 40 passed / 0 failed；`docs/backlog.md` 归档队列有且仅有一条本 change 条目。

### 归档后

- **归档提交**：`4aa403bf26f59ce6337be722dc329122922d2009`（归档目录 + 并入后的 living spec
  一起提交；`openspec/specs/harness/spec.md` 新增 70 行）。
- **包装器实际输出**：`Change 'add-explicit-skill-trace-nov26' archived as
  '2026-11-26-add-explicit-skill-trace-nov26'.`；`harness: update`（`+ 1 added`），
  `Totals: + 1, ~ 0, - 0, → 0`。
- **修链读数**：`归档后修链 0 处（扫过 4 篇 Markdown / 0 条相对链接）`；
  `openspec-links: PASS（校验 709 条相对链接，全部可达）`。
- **归档后审计**：`node scripts/openspec-archive-check.mjs --archived
  add-explicit-skill-trace-nov26` → `PASS（0 条 MODIFIED，对比 0 段；人工恢复 0 段，声明认领
  0 段）`（2026-11-26）。本 delta 只有 ADDED，审计的 MODIFIED 对账面无可比段落，故另做实质核对：
  living spec 末条 requirement「显式 Skill 加载痕迹」的 7 条 scenario 与 delta 逐条对应
  （7/7），无丢段。
- **docs-check**：归档后复跑 PASS（归档队列随 change 离开活跃区自然核销；backlog 79/80 行）。
