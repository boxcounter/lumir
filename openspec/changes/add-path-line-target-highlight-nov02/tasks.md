# Tasks: add-path-line-target-highlight-nov02

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件；MODIFIED 整块基于
      归档后（`2026-11-02-add-path-line-range-links`）的 living spec 抄录
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；批准面：仅 harness 正文路径链接、单行与行列高亮整行、
      行范围闭区间、`Decoration` 行装饰、约 1.4s 瞬态、重复点击替换、切标签清除、正文 / 撤销栈 /
      dirty 不变、越界钳制、超大范围性能护栏）——Alex 2026-11-02：「好，请你动手。」

## 1. 解析层与数据链（纯函数）

- [x] 1.1 `src/harness-path-link.ts`：`lineSuffixAt` 返回 `lineEnd`（单行 / 行列 = `line`，
      行范围 = `止`），`PathCandidate.lineEnd` 声明并接线（唯一消费者是高亮）
- [x] 1.2 单测（扩 `tests/unit/harness-path-link.test.ts`）：`:12` / `:12:3` → `lineEnd = 12`；
      `:12-40` → `lineEnd = 40`；畸形形态 `lineEnd` 缺省；`:12` / `:12:3` 的既有读数逐字不变
- [x] 1.3 编排：`PathJumpPlan.highlight?` + `openPathAtLine(..., lineEnd?)`，带 `lineEnd` 时在首轮
      让位窗口内调用一次 `highlight(起, 止)`，复核补发不重设高亮；单测同时断言**不带 `lineEnd` 时
      零调用**（快速打开 / 外部打开 / 工具卡片的回归锚点）

## 2. 编辑器行高亮原语

- [x] 2.1 新增 `src/navigation-highlight.ts`：`Decoration.line` 行装饰 StateField、`setLineHighlight`
      状态效果、`NAVIGATION_HIGHLIGHT_MS = 1400`、`MAX_HIGHLIGHT_LINES = 2000`；越界钳到文档边界、
      超上限返回空装饰（只落点不高亮）
- [x] 2.2 `src/editor.ts`：基础层装 `lineHighlightExtension`；`EditorHandle.highlightLineRange(from, to)`
      先清旧计时器再设新装饰；计时器按**会话 state** 清除（前台 dispatch / 后台换代 state / 已关闭跳过）
- [x] 2.3 `activate()` / `closeSession()` / `reset()` 清理高亮与计时器（切标签清除；关闭会话不留残余）
- [x] 2.4 `src/style.css`：`.cm-line-highlight` 取 `--pending-tint`，eink 档覆写 `rgba(0,0,0,0.1)`
      （与 `.cm-quote-jump-flash` 同口径，不新增 token）

## 3. 接线（只覆盖 harness 正文路径链接）

- [x] 3.1 `src/harness-panel.ts`：`PathLinkRenderContext.openFile` / `PathLinkTarget` /
      `HarnessPanelDeps.openVaultPath` 增加 `lineEnd`；正文候选透传，工具卡片目标不带
- [x] 3.2 `src/main.ts`：`jumpPlanFor` 注入 `highlight`（`handle.highlightLineRange`）；面板回调
      传 `lineEnd`；快速打开 / 外部只读打开调用点逐字不变
- [x] 3.3 核对非目标入口：工具卡片、quick-open、wikilink 锚点跳转、⌥G 行跳转均不产生高亮
      （单测 + 代码路径核对）

## 4. 测试

- [x] 4.1 扩 `tests/unit/harness-path-link.test.ts`（装饰层的纯逻辑与它的入口写在一起；node 直接驱动
      `EditorState`）：单行 / 闭区间装饰数与行首位置、越界钳制、2000 行上限的正反两例、重复设置替换、
      `null` 清除、文档变更即清除、效果施加不改 `doc` / `selection`
- [x] 4.2 更新 `tests/visual/scenes/m632-path-line-range-link.spec.ts`：行装饰在场且只覆盖
      120–140 行（119 / 141 不在集合内）、选区仍折叠、正文逐字节不变、单行链接只高亮一行、
      重复点击不叠加、切标签清除、三主题（light / dark / eink）计算背景非透明且区别于行底色；
      **不新增像素基线**。场景 8/8 PASS（含两条反向验证：去掉切标签清除、去掉计时重置各自判红）
- [x] 4.3 更新真机场景 `scripts/acceptance/scenarios/221-harness-path-line-range.md` 与
      `fixtures/harness-mock-path-line-range.json`：点击后截图判读目标行带底色、消退后消失；
      如实登记「AX 读不到装饰类名」为已知边界。`node scripts/acceptance/run.mjs --check` 239 个
      场景全 PASS（真机执行归 5.5）
- [x] 4.4 长范围性能护栏：2000 行上限的构建耗时读数落 design §2.2；单测断言上限两侧行为

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过：`Totals: 35 passed,
      0 failed (35 items)`，退出码 0
- [x] 5.2 `node scripts/openspec-archive-check.mjs` 通过：`PASS（扫过 8 份 delta，7 条 MODIFIED，
      对比 118 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目）`，退出码 0
- [x] 5.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）：干净 rebase（`--onto
      master 5084dcd`，去掉启动快照）后持 cargo 锁复跑，完整日志 `/tmp/lumir-gate-823-quick.log` ——
      **`GATE RESULT: 13/13 PASS（SKIP 0）`，`GATE_EXIT=0`**（后台任务退出码 0）。此前首跑唯一 FAIL
      是本 delta 的相对链接深度（已修）；磁盘满两次中断与启动快照 prompts 字节指纹红均已由 tower 处置
- [x] 5.4 `bash scripts/gate.sh visual` 全绿（动过 `src/style.css` 与 `tests/visual/**`；完整日志
      `/tmp/lumir-gate-823-visual.log`）：**`GATE RESULT: 15/15 PASS（SKIP 0）`，`GATE_EXIT=0`**
      （后台任务退出码 0）。其中 visual-regression 613s，套件读数 **936 passed / 1 skipped（10.1m）**；
      m632 场景 8/8 含三主题与两条反向验证。**未更新任何视觉基线**
- [ ] 5.5 真机验收场景 221 复跑（20:00 后窗口）并把证据落 `.local/acceptance/`（不落 worktree）
- [x] 5.6 信息卫生清扫：新增 / 改动的文档、fixture、场景对改动面做一次 text 级 grep，
      `/Users/`、`~/.config`、验收 vault 路径等零命中；样例全为合成串
