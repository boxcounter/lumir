# Tasks: block-copy-affordance

> 本 mission（M263）只产提案四件套，下列任务属**实现期**，等 Alex 节点 1 裁决后由后续 mission 承接。
> 裁决改推荐项时，先按 proposal 的裁决点表改写 delta 与本文件，再动工。

## 1. 文案 deck 与编号登记

- [ ] 1.1 `文案-Copy.md` 追加三条（编号在 proposal 的「文案 deck 登记」节已声明为 D153–D155）：
  触发钮读屏名「复制{块类型}」、toast 成功「已复制{块类型}」、toast 失败「复制失败：{原因}」，
  两列（中文 / English）齐全。
  **验收口径**：动工前先核 deck 末位（M261 与 M267 都声明过 D152，见 proposal 该节）——
  取当时末位的下一个可用编号，按 deck「只追加、不复用」的规则登记；「表格 / 代码块」两个块类型词
  只写一份词表，三处复用。
- [ ] 1.2 实现期核对上屏语言：按 deck 现状（D149–D151 之外条目上屏取中文列）；若 M267 的语言层已落地，
  这三条随语言层取值。

## 2. 触发钮与按钮群（对应裁决点 2 / 3）

- [ ] 2.1 `src/style.css`：抽共享形态类 `.lumir-block-trigger`（壳 / 尺寸 / 圆角 / 图标色与热态 /
  过渡 / `opacity`+`visibility` 出现时机 / eink 两条规则 / `focus-visible` 浮现），
  既有 `.lumir-table-fs-trigger` 只保留位置偏移并**同时带共享类**（既有选择器逐字继续有效）。
  **验收口径**：静止态整页基线零变化（钮静止态 `visibility: hidden`，本就不在基线里）；
  `tests/visual/scenes/m240-table-fullscreen*.spec.ts` 不改选择器即可跑绿。
- [ ] 2.2 新增复制钮的类与偏移：`.lumir-block-copy-trigger`（`top: 6px; right: 36px`，26×24），
  放大钮保持 `right: 6px` 不动；组内次序、间隙、锚点只写一处。
- [ ] 2.3 `src/preview/`：新增复制钮 widget（`mousedown` preventDefault + `click` 时现取块范围），
  与既有全屏钮并列挂在同一块上；图标为自绘 SVG（双矩形「复制」字形，1.4px 描边、currentColor、
  14×14 / viewBox 16×16，与 `table-trigger.ts` 的四角框同一手法）。
- [ ] 2.4 `src/editor.ts`：为代码块装零足迹 slot 层（BlockWrapper rank 20，`position: relative`），
  挂在 `wrapExtensions` 旁**独立于** `codeBlockWrappers` 的折行条件。
  **验收口径**：装 / 不装 slot 两态几何逐值相同（借 m240 场景的对比手法）；折行开 / 关两种口径下
  块内都不出现横向滚动容器（M180 口径不变）。
- [ ] 2.5 M262 共存核对：动工前查 `feat/proposal-code-block-fullscreen-m262` 与实际落地状态——
  若 M262 已落地，复制钮并入其按钮群（零搬移，落在放大钮左侧）；未落地则按 design §2.3 的
  「先落地者占角」落点，并在本 change 的 design 里补记当时的落地次序。

## 3. 复制内容口径（对应裁决点 1）

- [ ] 3.1 新增 `src/preview/block-copy.ts`：纯函数（给定 `EditorState` 与块范围 → 复制文本）。
  表格 = `Table` 节点源码切片；围栏块 = `CodeText` 子节点切片；缩进块 = 相邻 `CodeText` 子节点
  文本按序拼接（丢弃节点间隙 = 语法缩进）；不追加尾换行。
- [ ] 3.2 `tests/unit/block-copy.test.ts`：表格含分隔行与对齐填充、围栏块不含围栏行与语言标记、
  缩进块剥语法缩进且保留相对缩进、空块空串、无尾换行、CRLF 源文件的结果换行为 LF。
- [ ] 3.3 若裁决点 1 改选备选（TSV / 双入口 / 多 flavor）：改写 §3.1–§3.2 与 delta 的对应条文，
  并在 design 里补记裁决后的格式口径；多 flavor 选项须先做一次真机探针
  （WKWebView 是否允许 `ClipboardItem` 写 `text/html`），探针失败则回退并在 design 记录。

## 4. 命令入口（裁决点 5 取推荐项时）

- [ ] 4.1 `src/keys.ts`：`block.copy` 进 `COMMAND_IDS`、加进 `KEYLESS_COMMAND_IDS`（作用域 `editor`）。
- [ ] 4.2 `src/main.ts`：命令实现 + 命令级命中条件（caret 在渲染为 grid 的表内 / 在围栏或缩进代码块内；
  判据取自语法树与表格模型，不读 DOM），命中条件不满足时不消费事件。
- [ ] 4.3 `tests/unit/keys.test.ts`：既有对账自动纳入新命令；补一条「命中条件不满足时不消费事件」的用例。
- [ ] 4.4 若裁决点 5 取备选（只做鼠标钮）：撤掉本组与 `keymap-commands` 的 delta 整份，
  并在 design 的判据分层节把「真机层无钮路径」的缺口如实留在已知边界里。

## 5. 装配、反馈与只读边界

- [ ] 5.1 `PreviewContext` 增 `blockCopy()` 口子（形状同 `tableFullscreen()`，未接线返回 null），
  `src/main.ts` 装配：读 `EditorState` 切片 → `navigator.clipboard.writeText` → toast。
- [ ] 5.2 成功 = success tone 的 D154；失败 = D155 + 一条 `console.warn`（不借语义不符的诊断事件名，M244 口径），
  MUST NOT 静默。
- [ ] 5.3 只读断言：点击 / 执行命令后 `EditorState.doc`、选区与光标落点、磁盘文件三者逐字节 / 逐值不变。
- [ ] 5.4 性能读数：真机量一次大代码块（≥512 KiB）从点击到 toast 的时延并落档；量不出人可感延迟就只记读数。

## 6. 真机验收场景 58

- [ ] 6.1 新增 `scripts/acceptance/scenarios/58-block-copy.md` + fixture（含宽表 / 窄表 / 降级表 /
  围栏代码块（含相对缩进）/ 缩进代码块（含更深缩进）/ mermaid 块），步骤按 design §7 的十条草案落成。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 58` 真机 PASS，
  证据落 `test-results/acceptance/<日期>/58-block-copy/`（`status.txt` = PASS）。
- [ ] 6.2 反向验证：解绑 `block.copy`（或回退实现）后重跑，正观测步必须 FAIL，现场留档。
- [ ] 6.3 触发钮的真机路径如实记为**未覆盖**（同场景 40 口径：鼠标路径由 chromium 场景覆盖）；
  若 Alex 要求真机也验钮，先请 tower 扩 scope 给套件加 `hover` 动作（先例 M244 的两处窄扩展）。

### 编号声明

真机场景取 **58**。依据（2026-09-27 动工前逐条核对过）：
master `scripts/acceptance/scenarios/` 现有编号最大 **52**（`52-dir-rename-expand.md`）；
本批在飞 / 已落地的声明依次把 **53** 给了 M259（`53-bold-click-selection.md` 已在
`feat/bold-click-selection-fix-m259` 落地）、**54** 给 M260（`openspec/changes/bare-url-cmd-click/tasks.md`
的编号声明节）、**55** 给 M267（`ui-language-i18n/tasks.md` 的编号声明节）、**56** 给 M261
（`goto-line-command/tasks.md` 的编号声明节）、**57** 给 M262（tower 的批次分配）。
M267 那份声明写在更早的快照上（当时把 51–53 留给 M261/M262/M263），已按「实现期动工前再核一次目录与
各 change 的编号声明，不盲取」的纪律核对并更新为上述占用表。
实现期动工前 SHALL 再核一次 `scripts/acceptance/scenarios/` 目录与上述各 change 的编号声明。
**另：文案 deck 的 D153–D155 已在 proposal 里声明**（碰撞如实登记，见 proposal 该节）。

## 7. 测试与门禁

- [ ] 7.1 `tests/visual/scenes/`：新增按钮群场景——静止态零足迹（钮不可见、不进读屏树、块几何逐值不变）、
  hover 后两钮同时浮现且间隙 4px、点击后 chromium 剪贴板内容正确、与既有表格全屏钮共存不冲突；
  新增一张 hover 帧整页基线（静止态基线零变化）。
  **验收口径**：`bash scripts/gate.sh visual` 全绿；基线新增 / 更新前截图须 Alex 过目
  （AGENTS.md 视觉门禁卫生）。
- [ ] 7.2 `tests/unit/run.mjs` 全绿、`npx tsc --noEmit -p tsconfig.json` 通过。
- [ ] 7.3 `bash scripts/gate.sh quick` 全绿。

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 8.2 `bash scripts/docs-check.sh` PASS。
- [ ] 8.3 真机 `node scripts/acceptance/run.mjs 58` PASS（证据落档，含 6.2 的反向验证现场）。
- [ ] 8.4 `bash scripts/gate.sh visual` 全绿（本地跑，CI 只跑结构层）。

## 9. 收口

- [ ] 9.1 `docs/backlog.md` 登记本 change 的待归档跟踪与实现期的已知边界（代码块大小上限的读数、
  CRLF 换行归一、窄块外溢与落地次序的过渡形态）。
- [ ] 9.2 review-request 逐任务对账（含裁决点与 delta 的一致性）。
