# ADR 0008: 内容区 pane 化——split view 与 harness 归位的统一模型

- 状态: accepted（2026-10-03 当日经 Alex 裁决接受，无 Decision 翻转）
- 日期: 2026-10-03
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 措辞修订（2026-10-06）: Decision 8 与 Consequences 里的「pin 式上下文块 / pin 上下文」改为**摘录引用卡片**表述——pin 机制 2026-10-05 经 Alex 裁决推翻，替代机制随 change `add-harness-quote-cards` 落地。本次只改措辞与指向，决策内容零改写（finding `20261005-tower-improve-adr-0008-pin-wording-superseded-by-capsule-ruling`）。

## Context

- Harness v1（change `add-harness-probe`，归档 2026-10-03）以右栏 dock 落地：应用骨架 grid 第三列（`src/style.css:334`），宽度钉死 348px（`--layout-dock-w`，`src/style.css:240`）。Alex 试用反馈：宽度不可调且默认过窄、视觉停留在探针期、缺模型选择、切 vault 后面板不刷新、需要对正文指定段落做针对性探讨。
- Split view 是既有独立想法：两栏正文，典型场景一栏文档一栏代码（代码文件已可编辑形态打开，`src/preview/attachments.ts:187` 的 editable-non-md-files 口径）。它与 harness 叠加后出现「四栏困境」：树 | 正文 A | 正文 B | harness。
- **诊断**：四栏困境是「harness 在 chrome 层（grid 列）、split view 在内容层」两层各自扩张相撞的产物。统一到一层后困境消解。
- **与 ADR 0002 §2 的冲突**：该条明文「一个组件、两种模式，**不做两个编辑器**」。其原意是源码/预览不拆成两个编辑器组件（单一 CodeMirror 内核承担两种模式），但 pane 化意味着两个 `EditorView` 实例并存，字面上触碰该条，必须显式处理（见 Decision 5）。
- **Survey 证据**（2026-10-03 四路代码探索，结论均有 文件:行 证据）：
  - 单例假设面：全应用一个 `EditorView`（`src/editor.ts:1820` 唯一构造点），`createEditor` 是自包含工厂（`src/editor.ts:1277`），多实例结构上不冲突；但约 10 个模块构造期捕获 `editor`/`editor.view` 单例（toc、tabs、save-controller、link-follow、harness-panel、content-width drag、notice、search、goto-line、fullscreen 族），命令分发写死单例（`src/main.ts:1282` 的 `isEditorEvent`、`src/main.ts:1194` 把 `editor.commands` 直接摊平进全局命令表），`openFile` 与 `syncActiveDocument` 以「全局唯一前台会话」为落点。
  - harness 面板耦合面窄：只消费 `AppShell` 三个字段（`shell.root` / `shell.titlebar` / `titlebarIdentity.block`），对编辑器的依赖是窄接口 `HarnessContextSource`（`activeSession()` + `view.state/viewport`，`src/harness-context.ts:31`）+ `mirrorThemeScope` 源元素 + 焦点归还，面板 DOM 全自建、不碰 `shell.ts`。改造面在装配层「注入哪个 editor」，不在接口形状。
  - 键位：分发器机械层支持多段 chord（trie + pending + 1500ms 超时，`src/keys.ts:756`），但表内零 chord 且配置层拒绝多段（`src/keys.ts:722`、`src-tauri/src/config.rs:1188`）。`C-x` 前缀属 backlog「Emacs 档 3」未立项项。
  - 持久化先例：按 vault 一份 JSON（vault-sessions / reading-positions，tmp+rename、版本不符=无历史、写失败降级 warning）；运行期拖拽类偏好经 `config_set_ui_value` 回写（`ui.content_width` 先例）。
  - 性能：常驻内存实测 206–215MB，贴 250MB 门禁（合同 200MB 与门禁分叉已登记），第二个 CodeMirror 实例的成本落在窄余量内。跨实例全局态：`killSlot`（kill buffer，模块级单例）、mermaid 渲染队列（模块级单例）、`lists.ts` 每实例一条 document 级观察器。

## Decision

1. **内容区泛化为 pane 容器，v1 上限两个横向 pane。** 每个 pane 承载「一组文档标签（各带标签条）」**或**「harness 面板」之一。界面上限因此恒为三栏：树 | pane | pane——「四栏」在模型上不存在，而不是被宽度规则压制。不做 Emacs 式任意递归分窗（v1 两个 pane 覆盖全部已知场景：文档+代码、文档+对话）。
2. **harness 从 grid 第三列 dock 归位为 pane 内容件。** `⌘⇧A` 语义改为「在旁侧 pane 打开/收起 harness」（无第二 pane 时自动分栏）；dock 列与 `.dock-open` 机制随之移除。chat 栏宽度问题由 pane 分隔条（可拖拽，宽度经 `config_set_ui_value` 回写，`ui.content_width` 同路先例）吸收，不再单列「dock 宽度拖拽」功能。**注意与「阅读栏宽」区分**：`ui.content_width`（正文在编辑器内居中的排版宽度及其拖柄）是编辑器 pane 的内部属性，不在本决策范围，单 pane 与双 pane 均照常可用；双 pane 时 v1 保持全局共享同一 `content_width` 值（现状单配置键不动）。
3. **引入「活跃编辑器 pane」概念，与「焦点所在」解耦。** 焦点可以落在 harness pane、树或其他 chrome 上；编辑器命令、上下文注入（`assembleHarnessContext`）、modeline/树高亮/toc 跟随的对象是**最近活跃的编辑器 pane**（Emacs 的 selected window 语义：minibuffer 持焦不改变 current buffer）。命令分发从「摊平单例 commands」改为「按活跃 pane 解析该 pane 的 `editor.commands`」；`isEditorEvent` 泛化为「目标落在任一编辑器 pane 的 contentDOM 内」。
4. **会话所有权：一份文件同一时刻至多在一个 pane 打开。** 跨 pane 是「移动标签」而非「复制标签」——避免两个独立 `EditorState` 对同一文件的 dirty/保存冲突。这是相对 Emacs（同一 buffer 可显示在多个 window）的自觉简化，理由：共享 buffer 需要单 state 双 view 的更新协调，复杂度不成比例；已知场景（文档+代码、文档+对话）都不需要同文件双开。`killSlot` 保持全局单例（kill ring 在 Emacs 本就是全局的，语义正确）。
5. **显式修订 ADR 0002 §2 的「不做两个编辑器」。** 修订口径：该条约束的是「源码/预览不拆成两个编辑器组件」，继续有效；pane 化引入的是同一「单组件双模式」编辑器的**第二个窗口实例**（上限二），不构成第二个编辑器组件。ADR 0002 文本随本 ADR accepted 同步加注。
6. **持久化：pane 布局按 vault 持久化。** 扩展 vault-sessions schema（`panes: [{tabs, active}], harness_pane: bool` + 分隔条位置），沿用既有纪律（tmp+rename、版本不符=无历史、写失败降级 warning、路径校验复用 `valid_entry`）。
7. **键位：v1 不引入 `C-x` 前缀。** pane 系命令（`pane.split` / `pane.close` / `pane.other`）用单段键，取⌥系近亲（⌥G 代 `M-g M-g` 的既有先例）。`C-x` 前缀机制（分发器已支持、表与配置层未放开）归 backlog「Emacs 档 3」独立立项，不与本 ADR 捆绑。
8. **实施分期。** Phase 1 = pane 容器 + 双文档 split view（含命令路由、活跃 pane、会话所有权、持久化）；Phase 2 = harness 入 pane + chat UX 重做（先出 `design/prototypes/` 原型，Alex 已裁决）+ **摘录引用卡片**。「切 vault 后面板不刷新 + 事件流带 vault/会话标识」的小修包独立于本 ADR 先行（它是现行设计的缺陷修复，pane 化与否都要修；事件标识在 pane 时代继续受用）。Alex 已裁决推迟的宽度拖拽/模型选择/上下文策展机制：宽度拖拽被 Decision 2 吸收（取消），模型选择在 Phase 2 内推进；**上下文策展机制由「pin 式上下文块」改为摘录引用卡片**——Alex 2026-10-05 裁决 pin 是糟糕的设计、不需要（「我认为 pin 是一个糟糕的设计，我不需要」），替代机制为把正文选段摘录成引用卡片进 composer；经原型五轮迭代定型为 block 级引用卡片，决策内容随 change `add-harness-quote-cards` 落地（详见该 change 的 proposal / design）。放弃的只有 pin 独有的一项能力——「文档哪些段落已被讨论」的编辑器侧留痕（Alex 明确不要，未来若需要单独立项）。
9. **备择方案（已考虑并排除）。** ① 四栏并存+宽度预算规则：窄窗下全线崩溃，收缩规则补丁复杂度只增不减；② harness 浮层化：与「对照文档长期讨论」的 harness 主场景冲突；③ 不做 pane 化、split view 与 dock 各自独立演进：两层模型并存，耦合债后置且利息增长（每个新面板类功能都要重新回答「放哪层」）。

## Consequences

### 正面

- 四栏困境在模型层消解：布局上限恒为三栏，任何未来的面板类能力（toc 侧栏化、反链面板等）都有统一的归位答案。
- 与「Emacs keybinding PKM」定位（ADR 0006）同源：pane = Emacs window 的对应物，harness = 一个 buffer；心智模型单一。
- chat UX 重做的容器问题一次解决：宽度、位置、与正文的对照关系不再是特殊 cases；摘录引用卡片的「摘的是哪个文档」语义由活跃 pane 自然回答（ADR 0008 Decision 3 的「最近活跃编辑器 pane」——change `add-harness-quote-cards` 落地的摘录来源归属）。
- harness 上下文注入、命令路由、toc/modeline 跟随获得统一语义（最近活跃编辑器 pane），消除现状里「全局唯一前台」的隐含假设（`syncActiveDocument` 单同步点随之显式化）。
- 改造面经 survey 清点可控：`createEditor` 自包含、harness 窄接口已解耦、持久化与配置回写先例齐全；无 fork 依赖、无新 npm 依赖。

### 代价与风险

- **改造面大**：约 10 个模块的单例捕获要改为按活跃 pane 解析；tabs 需 per-pane 实例与 per-pane 标签条挂载点；toc 从持有裸 view 改为跟随活跃 pane；配置施加（setMode/applyTypography/setContentWidth 等）与能力注入改为遍历 pane。这是本 ADR 的主要实施成本。
- **内存风险**：第二个 CodeMirror 实例的开销落在 206–215MB 实测 vs 250MB 门禁的窄余量内，预计顶破现行门禁。**Alex 已裁决（2026-10-03）：pane 化过程中按实测提高门禁，内存使用的专项治理后置**——门禁不阻塞 pane 化工作；专项治理仍归 backlog 的 dogfood 性能专项队列。Phase 1 落地时实测双 pane 常驻内存并登记读数，作为提阈幅度与后续专项治理的输入。
- **跨实例全局态**：mermaid 渲染队列两实例共享（渲染串行、主题失效互相影响，可接受）；`lists.ts` document 级观察器翻倍（功能无冲突，观察器数量翻倍，可接受）；两者均需在实现期验证并如实登记。
- **测试面回刷**：整页像素基线大面积失效（UX 动荡期「批次末尾一次性重刷」纪律已备）；验收套件部分场景假设单编辑器，AX 查询需核对；视觉场景钉死的标题栏孩子序列（toggle 钮位置）若变动需同步。
- **偏离 Emacs 直觉**：同文件不能两 pane 对照（Decision 4），Emacs 用户可能期待同 buffer 双窗（如长文档首尾对照）。自觉的 v1 简化，Revisit 条件兜底。
- harness 入 pane 后，「随时可用的快速提问」路径变长（从无脑占右栏到需要分栏决策）；以 `⌘⇧A` 自动分栏 + 布局按 vault 记忆对冲。

## Revisit 条件

- 双 pane 实测常驻内存超门禁且专项治理无果 → 回退 Decision 2（harness 回 dock 列），或整体回退本 ADR。
- dogfood 中「同文件两 pane 对照」需求反复出现 → 立后续 ADR 评估共享 buffer（单 `EditorState` 双 `EditorView` 的更新协调）。
- 「三 pane 及以上 / 纵向分栏」需求出现 → 评估放开 pane 上限与分栏方向。
- backlog「Emacs 档 3」立项时 → 重估 pane 命令是否迁入 `C-x` 前缀体系（`C-x 2/3/o`）。
