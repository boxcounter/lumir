# Proposal: 修复 wikilink 光标无法进入与源码无法逐字符编辑

- Change ID: `fix-wikilink-caret-reveal-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 关联 change：[`add-wikilink-suggestion-nov24`](../../add-wikilink-suggestion-nov24/proposal.md)。两者可同批完成节点 1 评审，但无行为或归档硬依赖；按真实文件冲突排程，分别独立验收与归档。

> 评审记录
> 节点 1：独立评审 r3 clean / ready-for-Alex；Alex 于 2026-11-24 裁决「采纳。wikilink 按推荐。」推荐方案已完整写入 design 与 spec delta。

## Why

用户报告「光标在视觉上挪不进 wikilink」。现行 `collectWikilinks` 对 resolved / ambiguous / unresolved 的普通 `[[…]]` 建整条 replace 装饰，却没有标准链接与公式已有的选区显露判据；渲染 DOM 只剩 widget，指针只能映射到链接前后边界，水平移动则穿过不可见源码位置。旧测试 `tests/visual/scenes/markdown-editing-stability.spec.ts` 的「渲染态链接尾部点击后输入」还把只能落在边界写成了期望。

这是交互缺陷，不是新增导航语义。按[渲染/交互缺陷合同先行规则](../../../../docs/process/rendering-defect-contract-first.md)，必须先修订 `docs/specs/editor-caret.md` C6 与 live-preview 的旧不变量，再用输入分布属性测试证明，不得只修上述单个案例。

## What Changes

- 普通 `[[…]]` 复用 `touchesSource`：光标或选区触及源码 span 时撤下 replace、显露完整原文；移开后恢复三态渲染。进入后允许逐字素移动与编辑，不把整条链接作为一个原子步。
- 普通 wikilink widget 仅在**无修饰主键**入口复用 `enterReplacedSource`。Meta / Ctrl / Shift / Alt 都在 helper 之前直接让开，不得先执行编辑入口的 `preventDefault`、选区 dispatch、显露或聚焦：Meta 由既有 view-dom 链接跟随处理，Ctrl 交回既有系统次级点击路径；Shift / Alt 保留既有选区与原生手势结果，尤其 Shift-click 不得被折叠为空光标。
- 指针编辑采用明确的两次手势：第一次无修饰 click 或 drag 只进入源码，第一次 drag 不承诺产生选区；第二次在已显露源码上拖选 target / alias，选区严格等于用户拖出的源码范围，不外扩定界符。`EditorState.readOnly` 时不进入。
- pending 原本就显示源码；pending → resolved / ambiguous / unresolved 的异步完成不得重新遮住正在编辑的 span。无 resolver 的降级显示与 Rust 解析、跳转、歧义和未创建语义不变。
- 修订 `editor-caret` C6：只有没有显露判据的隐藏 inline 区间才按方向钳到可见边界；有显露判据的区间必须允许内部落点与逐字素编辑。
- 整条替换 `editor-live-preview` 中「标准 Markdown 链接」和「指针选区外扩」两个 requirement 的旧边界表述，并修改 `wikilink-navigation` 的三态显示 requirement。wikilink 仍不属于指针选区语法外扩集合；改变的是源码显露，不是选区外扩。
- 回扫并改准旧测试与注释，新增覆盖状态、修饰键、入口、方向、两次拖选、span 形态和上下文的属性矩阵；所有非编辑入口继续保证文档逐字节不变。

## Non-goals

- 不引入 `EditorView.atomicRanges`，不把 wikilink 做成一步跨过的原子对象。
- 不改变 wikilink 词法、Rust 解析、三态、Meta-Click 跳转、Ctrl-Click 系统次级点击、锚点、显式 ⌘⏎ 创建或 unresolved 样式。
- 不支持从渲染 widget 的首次 drag 直接拖出 alias 选区；该手势只进入源码，精确拖选由第二次手势完成。
- 不改变 `![[…]]`、附件、图片、unsupported 提示的渲染与指针行为。
- 不实现 `[[` 候选、创建候选行或任何自动打开行为；这些属于关联的 B change，而非本 change 的前置或后续归档条件。
- 不改变标准链接、公式、列表 marker 的既有编辑语义，不改写源文件格式。

## Impact

- 影响的 specs：`editor-live-preview`、`wikilink-navigation`；实现时先修订质量合同 `docs/specs/editor-caret.md` C6。
- 影响的代码/系统：live preview 的 wikilink 装饰与指针入口、共享光标合同、前端 visual / unit 与真机验收场景。
- 关联约束：ADR 0003 §3 源文件不改写；ADR 0002 §6 键入性能预算；渲染/交互缺陷合同先行规则。

## 待裁决点

1. **进入语义**：推荐「触及即显露、逐字符编辑」，与标准链接和公式一致；不采用「整条链接一个原子步」。后者会与 C6 的分流目标及全仓既有编辑范式分叉。

## 归档记录

### 归档前（节点 2 五要件）

1. **方案已批准**：节点 1 独立评审 r3 clean / ready-for-Alex；Alex 于 2026-11-24 裁决「采纳。wikilink 按推荐。」实现期没有新增行为或范围裁决。
2. **独立 reviewer clean / merge**：agent-375 结论 clean / merge，无 P1 / P2 findings，绑定产品实现 tip `31f88e69d47e4d04dcc970b1375577b95c767cb5`，评审原件 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/wikilink-caret-reveal-r1.md`。后续 `b4380bf9b06c7a6c599b8191b4da1835f03b99de` 仅为 865 场景与 tasks 的 test-only 修正，评审原件明确记录该边界；最终真机结果亦由独立评审会话确认。
3. **tasks 完成与边界**：1.1–4.2 的实现、验收项全部勾选。3.5 的就地边界为：真机 865 覆盖可装配路径，真实 `EditorState.readOnly` 由 visual fixture 验收；vault 外只读会话不注入 resolver，故不伪造「只读 + 三态 widget」的真机场景。4.3 是归档自身动作，在归档提交且 `--archived` PASS 后补勾。
4. **门禁与真机证据**：
   - 修前反例：8 failed / 2 passed，直接击中键盘内部仍隐藏、widget 中部无法进入、pending 遮回等旧行为；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/fix-wikilink-caret-reveal-nov24/pre-fix-red.log`。
   - 修后相关 visual：207 passed；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/fix-wikilink-caret-reveal-nov24/related-visual.log`。
   - 完整 `scripts/gate.sh visual`：`GATE RESULT: 15/15 PASS（SKIP 0）`（exit 0），visual 1431 passed / 1 skipped，前端单测 1951 passed / 0 failed，基线未更新；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/fix-wikilink-caret-reveal-nov24/gate-visual-final.log`。
   - 865 修正后的 quick：`GATE RESULT: 13/13 PASS（SKIP 0）`（exit 0）；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/fix-wikilink-caret-reveal-nov24/gate-quick-865-r2.log`。
   - 真机 865：1/1 PASS，29 断言、0 失败、19.3s；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-wikilink-caret-reveal-r2/`。首轮 mtime 推进来自场景自身两次显式 ⌘S，不是产品自动写盘；恢复原文后哈希相同而 mtime 合法变化，故 test-only 改在恢复保存后另记手势基线。AX 失败是 inline `AXStaticText` 无 bbox 的定位错误，test-only 改用 `AXTextArea` bbox 比例偏移。两项修正均未追加产品改动。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs --change fix-wikilink-caret-reveal-nov24` → `PASS（扫过 2 份 delta，3 条 MODIFIED，对比 67 段，无静默丢段）`；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `bash scripts/docs-check.sh` 均 PASS；`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。放行方式：机器 + 独立评审放行（本节要件）。

### 归档后

- **归档提交**：`daf2b29a915d4fc7ce3d68745c7102ac898e4272`（归档目录、living spec、反向关联链接与队列记录一起提交）。
- **包装器实际输出**：`editor-live-preview: update`、`wikilink-navigation: update`，`Totals: + 0, ~ 3, - 0, → 0`；`Change 'fix-wikilink-caret-reveal-nov24' archived as '2026-11-24-fix-wikilink-caret-reveal-nov24'.`，不是纯目录移动。CLI 报 `Task status: 16/17 tasks`，唯一未勾项为归档自身 4.3，已在审计 PASS 后补齐。
- **修链读数**：包装器修归档内链接 2 处（关联 change 与渲染缺陷合同链接）；随后因活跃关联 change 的反向指针仍指向旧活跃目录，首次 `openspec-links` 报 1 条不可达。将该反向指针改到归档目录后，`openspec-links: PASS（校验 699 条相对链接，全部可达）`。
- **`--archived` 审计**：`PASS（openspec/changes/archive/2026-11-24-fix-wikilink-caret-reveal-nov24：3 条 MODIFIED，对比 67 段；人工恢复 0 段，声明认领 0 段）`，跑于 2026-11-24T23:48:19+08:00；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/fix-wikilink-caret-reveal-nov24/archive-archived-audit.log`。
