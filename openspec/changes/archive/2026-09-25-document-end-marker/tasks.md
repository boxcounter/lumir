# Tasks: document-end-marker

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。

**实现阶段记录（M189，2026-09-21）**：Alex 节点 1 四项全取推荐项（取值见 [proposal.md](proposal.md) 的「裁决记录」），
因此本文件的条件项一项都不触发，实现按默认写法落地。证据目录：`test-results/m189/`（git 外，绝对路径
`/Users/boxcounter/Code/Boxcounter/lumir/test-results/m189/`）。
**指针订正（M208 归档节点 2，2026-09-25）**：本行原写的绝对路径指向 M189 的 worktree
（`.tower/worktrees/wt-189/…`），该 worktree 已随批次清理移除；证据的留存副本在主 checkout 的
`test-results/m189/`，逐项 `ls` 可核（REVIEW.md 第 7 条）。

**条件项**（本 change 未触发任何一条）：裁决落在**推荐项**上时，本文件的默认写法成立；落在备选上时，实现前先按裁决改写 delta 与本节条件项，不静默按推荐项做：

- 裁决点 1（文案）取备选③（无文字）→ 7.2 从「追加可见文案条目」改为「追加读屏名条目」，4.1 与 5.x 的文本断言改为 `aria-label` 断言。
- 裁决点 2（视觉形态）取任一备选 → 2.3 与 5.3 的形态断言按新形态改写（「短于栏宽一半 + 夹着文字」这两条判据随之改写，但「MUST NOT 与作者通栏分隔线同形」这条硬约束不放松）。
- 裁决点 3（出现形态）取备选①（常驻）→ 3.1 的判据作废、5.2 的两态断言改为「短文档也显示」，并追加一次基线重拍（AGENTS.md：基线更新先请 Alex 过目）；取备选②（滚到底才现）→ 3.1 改写为「占位恒定、只切换可见性」，并追加「滚动高度不受显隐影响」的断言。
- 裁决点 4（适用面）取备选①（md + code）→ 2.4 与 5.4 扩到 code 模式。

## 1. 现状读数与反向验证（实现前，先测再改）

- [x] 1.1 取一次**现状读数**：在一份超过一屏的 md 文档里滚到底，记录 ① 正文末尾没有任何元素（`.cm-content` 的最后一个子节点是最后一行）② 滚动容器的 `scrollHeight` 在顶部 / 中部 / 底部三次读数相同 ③ 滚到底前后界面上没有任何变化。
  **验收口径**：读数落 `test-results/<mission>/document-end-marker-before/readings.json`（可 `ls`）。
  **实测**（`test-results/m189/probe-before.json`）：长文三处 `scrollHeight` 均 1228、`clientHeight` 712，`.cm-content` 最后一个子节点是空行
  （`cm-line cm-lp-block-separator`），DOM 里没有任何标记元素（`markerCount: 0`、`textInDom: false`）；短文 `scrollHeight` 712 = `clientHeight`。
  三项与 design §1–§3 的机制推断一致。读数以 chromium 层为准（真机读数在同一目录的验收证据里）。
- [x] 1.2 反向验证（先红，[REVIEW.md](../../../../REVIEW.md) 第 1 条）：把「超过一屏的文档滚到底时标记可见（渲染盒宽高非零）」与「一屏装得下的文档没有标记」两条断言先写出来，在**未实现前**跑一次，两条都必须 FAIL。
  **实测**：`test-results/m189/red-before-implementation.log` —— 实现前 `tests/visual/scenes/end-marker.spec.ts` 六条用例全红（`6 failed`），
  红灯落在「标记在场」与「渲染盒几何」这两类判据上，不是「class 不存在」这类退化判据。
- [x] 1.3 取一次**性能与几何基线**（3.2 / 8.2 的对照值）：打开 1MB Markdown 的现有端点读数（口径见 `perf-measurement` spec），以及 1.1 的三次 `scrollHeight` 数值。
  **实测**：几何基线见 1.1 的同一份读数（3.2 复用）；键入路径的 A/B 读数落 `test-results/m189/perf-keypress-before.json` /
  `perf-keypress-after.json`（改动前 median 11.35ms / p95 19.60ms，改动后 median 11.45ms / p95 18.10ms，n=50 —— **无回退**，
  p95 两侧都高于 16ms 合同值，是本机 `scripts/perf/keypress-to-paint.mjs` 的既有状况，不由本 change 引入，也**不宣称达标**）。
  `perf-open-file`（1MB）端点是**占位口径**（`scripts/perf/open-file.mjs` 只量 `fs.readFile` + UTF-8 解码，不加载前端），
  它量不到本 change——如实记录，不作为「不新增测量」的证据（该条的真实依据见 3.3）。

## 2. 实现：标记本体

- [x] 2.1 按 [design.md](design.md) §1 实现标记本体（推荐机制 = `.cm-content` 的生成内容；样式落 `src/preview/theme.ts`，该文件头明确 preview 装饰的样式在这里、不碰 `src/style.css`）。
  **实测**：机制按 design §1.1.1 落为「同性质的独立元素」——`.cm-content` 的生成内容没有可读的渲染盒与文本节点，
  spec 的三条几何判据（渲染盒宽高非零 / 横线总宽小于栏宽一半 / 存在文本节点）与真机侧的 AX `@x,y W×H` 读数都取不到，
  因此改用挂 `.cm-scroller` 的真元素（`src/preview/endMarker.ts`），保留候选 A 全部被看重的性质。
  `git diff src/style.css` 为空；标记样式集中在 `src/preview/theme.ts` 的 `.cm-lp-end-marker*` 三条规则 +
  一条 `.cm-scroller.cm-lp-end-marker-visible` 的行尺寸规则。
- [x] 2.2 标记只进 md 模式的扩展束（`src/editor.ts:1180-1254` 的 md 分支）。
  **实测**：`src/editor.ts` 的 `modeExtensions` md 分支追加 `endMarker`（code 分支未改，`git diff` 可见）；
  5.4 的 code 模式断言（`.cm-lp-end-marker` count 0 + 行号栏在场）PASS。
- [x] 2.3 形态按裁决点 2 的裁决实现（推荐项：居中短横线夹弱化小字；文字色 `--dim`、线段色 `--bd-2`；字体 `--font-display` + 字距）。
  **实测**：标记的三条规则里 `var(--accent)` 零命中、`margin` 零命中（`grep -n "var(--accent)" src/preview/theme.ts`
  与标记规则段内的 `margin` 检索均为 0）；5.3 的「与分隔线可区分」断言 PASS。
- [x] 2.4 标记 MUST NOT 从属显露口径：光标 / 选区落在文档末尾时标记照常显示。
  **实测**：5.4 用例——点击编辑器、⌘A 全选、把光标放到 `doc.length` 之后各读一次，标记都在场（count 1）。
- [x] 2.5 标记 MUST NOT 参与文档：不进 `EditorState.doc`、不进保存字节。
  **实测**：5.5 用例三条断言——⌘A 复制出的文本不含标记文案、⌘F 搜标记文案计数 `0/0`（正观测：搜正文串有命中）、
  `readDocument(page)` 与 fixture 逐字节相同。

## 3. 实现：显示判据与几何稳定

- [x] 3.1 按裁决点 3 的裁决实现判据（推荐项：文档内容高度 > 可用视口高度时显示；空文档、只有 frontmatter 的文档不显示；MUST NOT 读滚动位置）。
  **实测**：判据是 `src/preview/endMarker.ts` 的 `endMarkerVisible`（唯一判定点，纯函数）；`grep -c scrollTop src/preview/endMarker.ts` = 0；
  重算触发点写在代码注释里（`.cm-content` 与 `.cm-scroller` 两个观察目标 + `update.docChanged`）；
  **剔除标记自身贡献**的实现口径：标记在 `.cm-content` 之外，量的就是这个内容盒的渲染盒高度，里面没有任何标记贡献，
  自我指涉在机制上不存在（见 5.2 的临界带断言与它的反向验证）。
- [x] 3.2 几何稳定：标记的高度贡献与滚动位置无关；纵向间距用 `padding`、高度固定。
  **实测**：5.6 用例——顶 / 中 / 底 / 回顶四处 `scrollHeight` 与 `clientHeight` 逐像素相同，回顶后的读数与第一次逐项相同；
  与 1.1 的读数对照：长文 `scrollHeight` 由 1228 变为 1288，增量 60px 恰等于标记自己的渲染盒高度。
- [x] 3.3 不新增测量与解析：标记的建立与判定都是常量级，不遍历文档、不新增读取。
  **实测**：判据的读只有两个既有布局数（`.cm-content` 的 `getBoundingClientRect().height`、`.cm-scroller` 的 `clientHeight`），
  且**搭 CM 自己的测量周期**（`EditorView.update` 每次重绘本就 `requestMeasure`，判据只把自己的 read/write 排进同一趟，
  不产生新的布局趟）。A/B 读数见 1.3（无回退）。1MB 打开端点未测得有效对照（该端点是占位口径，见 1.3）——**如实记录，不宣称达标**。
- [x] 3.4 未验证项实测（[design.md](design.md) §7 第 1 条）：实测编辑器是否因标记改变 `.cm-content` 的尺寸而做出反应（滚动锚点复位一类）。
  **实测结论：无反应（机制上不可能）**——标记在 `.cm-content` 之外，CM 的三处观察面都看不到它（`DOMObserver` 的 MutationObserver 观察
  `.cm-content`、ResizeObserver 观察 `.cm-scroller` 的盒子、高度预言机读 `.cm-line` 的矩形）；读数亦一致：
  `scrollHeight` 的增量恰好等于标记的渲染盒高度（1228 → 1288，+60），四种滚动位置上标记状态与几何逐项恒定。记录落 design §7 第 1 条。

## 4. 单测（`tests/unit`，纯逻辑层）

- [x] 4.1 把可纯化的部分抽出来并加断言：显示判据（给定内容高度与视口高度 → 显示与否）与文案组装（把 deck 的串组装成标记文本）。
  **实测**：`tests/unit/end-marker.test.ts` 新增 3 条用例（判据真值表含「恰好一屏」与视口高度为零 / 负值；deck D114 逐字一致）。
  `node tests/unit/run.mjs` = `88 passed, 0 failed`（本 change 前 85 条）。
- [x] 4.2 不把 DOM / 布局行为硬塞进这一层（`tests/unit/README.md` 的分工：DOM 与布局归 visual）。
  **实测**：`git diff tests/unit/harness.ts` 为空；本 change 未改替身层（`endMarker.ts` 被单测层导入，因此避开了 Node 类型剥离不支持的
  构造器参数属性——这条约束写在实现文件里）。

## 5. 视觉场景（chromium，CI 门禁）

- [x] 5.1 新增场景 `tests/visual/scenes/<场景名>.spec.ts` 与 fixture（**三份文档**：内容超过一屏的、一屏装得下的、**内容高度恰好落在判据临界带内的**）+ 一个含作者手写 `---` 的组合输入面。1.2 的红灯在此转为绿。
  **实测**：`tests/visual/scenes/end-marker.spec.ts` + `tests/visual/fixtures/end-marker/{long,short,band}.md`（长文里含作者手写 `---`）；
  红转绿对照 = `red-before-implementation.log`（6 红）↔ 本场景 6 绿（`gate.sh visual` 的 `visual-regression` 步骤）。
  判据全是几何与文本读数（渲染盒、线段宽度与栏宽之比、计算色、文本节点），没有「class 存在」型断言。
- [x] 5.2 两态断言：超过一屏 → 标记渲染盒宽高非零且居中；一屏装得下 → 标记不存在；再在同一场景里把文档补长（或压矮视口）→ 标记出现（配对正观测，[REVIEW.md](../../../../REVIEW.md) 第 2 条：负向断言不得空转）。**覆盖缺口补一笔（M188 r1 P2-1）**：fixture 不能只取「明显装得下」与「明显装不下」两端，必须再有一份内容高度**恰好落在判据临界带内**（`clientHeight − 标记高度` 与 `clientHeight` 之间）。
  **实测**：用例 1（两态 + 压矮视口 → 出现 + 放高视口 → 消失的三步配对）与用例 2（临界带）。
  临界带那份 fixture 的实测：`natural = clientHeight − 8`，断言当场证明它落在 `(clientHeight − 标记高度, clientHeight]` 带内
  （标记高度实测 60px > 8），并断言标记不显示；随后再压矮 120px → 标记出现（配对）。
  **反向验证**：`test-results/m189/red-self-reference.log` —— 判据临时改成读含标记贡献的 `scrollHeight`（且标记空间恒定预留）后，
  临界带与两态两条都红（红灯落在「标记在场」的断言上）。
- [x] 5.3 形态与配色断言：线段总宽 < 阅读栏宽的一半、标记内存在文本节点、文字色 = `--dim`、线段色 = `--bd-2`；与同一文档里作者手写分隔线的通栏线在同一断言里对照。
  **实测**：用例 4 断言两条线段各 45.9px、合计 91.8px < 栏宽 764.8px 的一半，线高 ≤ 1px，线段色 `rgb(207, 196, 166)` = `--bd-2`，
  文字色 `rgb(141, 132, 113)` = `--dim` 且非 `--accent`，字体族命中宋体族；同文档里作者手写的 `.cm-lp-hr` 宽 = 栏宽（> 栏宽一半）。
  **反向验证**：`test-results/m189/red-full-width-line.log` —— 把线改成 `inlineSize: 100%` 后该用例红（720px ≮ 382px）。
- [x] 5.4 md / code 与显露口径断言：同一份内容在 code 模式下没有标记；光标落在最后一行、全选后标记仍在场。
  **实测**：用例 5——`.txt`（code 模式，行号栏在场）里 `.cm-lp-end-marker` count 0；md 长文里 ⌘A 与光标落到 `doc.length` 之后各读一次都在场，
  且 `EditorState.doc` 仍与 fixture 逐字节相同。**补一条（实现期实测新增）**：md → code 切换后元素与滚动容器的在场态 class
  （`cm-lp-end-marker-visible`，它带着 `grid-auto-rows: max-content` 那条行尺寸口径）必须一起离场——首轮实现漏了 destroy 里的 class 清理，
  该断言在 `gate.sh visual` 上实测红过（`test-results/m189/red-scroller-class-cleanup.log`），修好后转绿。
- [x] 5.5 非文档性断言：`⌘A` 复制得到的文本里没有标记的文案；文件内搜索标记文案无命中；`readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
  **实测**：用例 6 三条全绿（搜索面板计数 `0/0`，正观测：搜正文串计数非 0）。
  **反向验证**：`test-results/m189/red-document-content.log` —— 临时把标记同时当成正文追加进文档后，复制出的文本里出现「到底了」，该用例红。
- [x] 5.6 几何稳定断言：滚到顶 / 中 / 底三次读 `scrollDOM.scrollHeight`，三次逐像素相同。
  **实测**：用例 3 断言四处读数逐项相同，并断言「标记随内容滚动」（滚到底时它的视口纵坐标更小、且落在滚动容器内）。
  **反向验证**：`test-results/m189/red-scroll-position-criterion.log` —— 判据临时改成「滚到底才显示」后，回顶的读数与第一次不同（1228 ≠ 1620），该用例红。
- [x] 5.7 基线核对（[REVIEW.md](../../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：逐张核对 13 个像素基线场景是否需要更新。
  **实测**：推荐项下**零基线更新**，两条证据——① `bash scripts/gate.sh visual` = `GATE RESULT: 12/12 PASS`（含 `visual-regression 225s`，
  43 处像素断言在 0.001 容差下全绿；日志 `test-results/m189/gate-visual.log`）；② **内容判据逐张核对**：
  16 份被这些场景打开的 fixture 逐份实测（`test-results/m189/baseline-fixtures.json`）——9 份内容超过一屏（900 / 4898 / 4534 / 742 /
  5489 / 929 / 889 / 1964 / 1050px）而标记在 `scrollTop=0` 时**在视口之外**（`markerInViewport: false`），7 份装得下（内容高 = clientHeight 712）
  根本没有标记；基线是 1200×800 的视口截图（未开 `fullPage`），因此这些基线不可能框到标记。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [x] 6.1 **新增场景** `scripts/acceptance/scenarios/27-document-end-marker.md`（编号按现有最大 26 续；`item` 字段取 27），覆盖：打开超过一屏的文档 → 翻到底 → 标记在场；打开一屏装得下的文档 → 没有标记。
  **断言形态**：可见性 MUST NOT 只断言「AX 里有『到底了』这段文字」（M178 finding）——真机通道读不到文本节点的几何（见 6.2），
  因此可见性判据落在 chromium 层的几何断言 + 截图证据上，真机侧判的是「标记的可读文本节点存在 / 不存在」这一对 + 文档文本纯度 + 磁盘逐字节。
  **实测**：`--check` = `CHECK PASS 27-document-end-marker`；真机运行 **PASS（14 条断言 / 0 失败 / 30.195s）**，
  证据 `test-results/acceptance/2026-09-21/27-document-end-marker/{status.txt,steps.md,shots/}`（最终 tip 上的那一次；
  断言数与耗时取自同批的 `test-results/acceptance/2026-09-21/results.json`，`summary.md` 的表格里写作 `14 / 0 / 30.2s`），
  副本 `test-results/m189/acceptance-27-pass/`。**订正（M208 归档节点 2）**：`test-results/acceptance/2026-09-20/27-document-end-marker/`
  **不是**「首次 PASS」——那一份 `status.txt` 实测 = **FAIL（14 条断言 / 2 失败）**，是 6.4 反向验证的场地
  （两处记载的 `startedAt` 相同，互为印证）。截图 `shots/02-长文滚到底.jpeg` 可见：末段之下是「—— 到底了 ——」的短线夹字（弱化暖色）。
- [x] 6.2 探针：先用一次探针确认标记在真实 WKWebView 的 AX 树里是否可读（生成内容是否进 AX）。
  **实测（探针读数，落进场景说明的「覆盖边界」段）**：标记**进 AX 树**，形态是 `- [192] AXStaticText = "到底了"`，
  位置与 `AXTextArea` 同级（在 textbox 之外，印证它不是文档内容的一部分）。但该节点**没有 bbox**：
  这条 AX 通道只给 `AXButton` / `AXImage` / `AXScrollArea` 一类节点 `@x,y W×H`，纯文本节点不携带几何——
  所以「可见性」不在真机通道判（场景说明里写明这条边界与三条替代证据），MUST NOT 写成「读不到即通过」。
  另一条探针读数：标记在**首屏**（未滚到底）时节点已在 AX 里，正是 M178 记的那类假阳性，故该断言只当「在场」证据。
- [x] 6.3 场景 fixture 落 `scripts/acceptance/fixtures/`（两份 md：超过一屏的、一屏装得下的），与 md 一起进合成 vault。
  **实测**：`end-marker-long.md` / `end-marker-short.md` 在场景 front-matter 的 `fixtures:` 里逐条列名；真机 PASS 即两份都已进合成 vault。
- [x] 6.4 真机反向验证：把标记的渲染临时去掉（或回退到实现前代码）跑同一场景，断言必须 FAIL。
  **实测**：把判据临时改成恒为「不显示」（`read: () => false`，即标记的渲染被去掉）后重跑本场景 → **FAIL（14 条断言 2 失败）**，
  红的正是两条「标记的可读文本节点在 AX 里」；FAIL 的 `status.txt` / `steps.md` 留档
  `test-results/acceptance/2026-09-20/27-document-end-marker/`（副本 `test-results/m189/acceptance-27-reverse-fail/`）。
  短路只用于反向验证，随后立即还原并重新 `pnpm build`（还原后的 `gate.sh visual` 全绿见 8.2）。
- [x] 6.5 不改写源文件的真机判据：`editor.unchangedSince`（编辑器内容）与磁盘文件的 `unchangedSince` 两条断言在位且 PASS（ADR 0003 §3）。
  **实测**：磁盘侧 `record` + `file.unchangedSince` 两条（长短文档各一条，均 PASS，哈希 `1c59c4f70af8` / `96fb3e7e9e47`）；
  编辑器侧**不用**跨滚动位置的 `unchangedSince`（长文档的 AX 文档文本会随渲染视口变化，跨位置逐字节比较会假红），
  改用「`editor.not`（标记文案不在文档文本里）+ `editor.has`（末段真正文在场）+ `ax` 里标注记节点在 textbox 之外」三条配对，均 PASS。

## 7. 文案 deck

- [x] 7.1 按裁决点 1 的裁决处置 [文案-Copy.md](../../../../文案-Copy.md)：追加 D114 一行（末位当前 D113），中文与 English 两列都给，并在文末「文案实现备注」段登记归属文件（新条目按既有惯例在结尾补一句批次说明）。
  **实测**：`文案-Copy.md` 第 105 行 D114（中文「到底了」/ English `That's all`）+ 编号沿革段一句 + 实现备注段一条归属
  （`src/preview/endMarker.ts` 的 `END_MARKER_TEXT`）；`tests/unit/end-marker.test.ts` 按 deck 表格行逐字断言，两边漂移即红。
- [x] 7.2 裁决点 1 取备选③（无文字）时：D114 登记为读屏名条目（与 D76「分隔线」同形），并核对 [foundation-markdown §5](../../../../docs/specs/foundation-markdown.md) 的可访问性口径。
  **不适用**：裁决取推荐项（有可见文字），该条条件项未触发。

## 8. 验证与收官

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **实测**：`GATE PASS openspec-validate 2s`（`test-results/m189/gate-visual.log`，quick 层的一步）。
- [x] 8.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿（视觉侧按 AGENTS.md 的口径本地跑，CI 只跑结构层）；`bash scripts/docs-check.sh` PASS。
  **实测**：`LUMIR_VISUAL_PORT=4291 bash scripts/gate.sh visual` → `GATE RESULT: 12/12 PASS（SKIP 0）`
  （含 quick 全部十一步 + `isolation-runs` + `visual-regression 225s`）；日志 `test-results/m189/gate-visual.log`。
- [x] 8.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **实测**：`node scripts/acceptance/run.mjs 27` 在最终 tip 上 = **PASS（14 条断言 / 0 失败 / 30.195s）**
  （数字订正于 M208 归档节点 2，ground truth = `test-results/acceptance/2026-09-21/results.json`），报告
  `test-results/acceptance/2026-09-21/summary.md`，场景证据 `test-results/acceptance/2026-09-21/27-document-end-marker/`；
  另跑了一次反向验证（见 6.4，FAIL 留档 `test-results/acceptance/2026-09-20/27-document-end-marker/`）。
- [x] 8.4 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读依赖须先报 tower 批准）。
  **实测**：`git diff --check` 无输出；改动集合 = `src/editor.ts`、`src/preview/endMarker.ts`（新增）、`src/preview/theme.ts`、
  `文案-Copy.md`、`tests/unit/end-marker.test.ts`（新增）、`tests/visual/fixtures/end-marker/**`（新增）、
  `tests/visual/scenes/end-marker.spec.ts`（新增）、`scripts/acceptance/fixtures/end-marker-*.md`（新增）、
  `scripts/acceptance/scenarios/27-document-end-marker.md`（新增）、`openspec/changes/document-end-marker/**`；
  `git diff --stat src-tauri/ src/style.css src/keys.ts src/preview/livePreview.ts src/preview/attachments.ts` 为空。
- [x] 8.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（逐 requirement 对一眼实现与断言）、living spec 归档另走节点 2。
  **实测**：spec 的两条 ADDED requirement 逐条对账——「正文末尾的结束标记」的判据 / 形态 / 配色 / 只 md / 不从属显露口径，
  分别落在 5.2 / 5.3 / 5.4；「非文档性与几何稳定」的四条（不进 doc、不被复制搜索带出、滚动高度恒定、间距用 padding）
  分别落在 5.5 / 5.5 / 5.6 / 2.3 与 3.2。living spec 归档（`openspec/specs/editor-live-preview/spec.md`）另走节点 2。

## 9. 已声明的边界 / 不做

- [x] 9.1 不做阅读进度读数（百分比 / 进度条 / 状态栏 / 剩余行数）；不做滚动行为改造（回弹抑制、吸附、`overscroll-behavior`）；不做「回顶」按钮、分页 / 懒加载；不做分节结束标记；不做字数 / 阅读时长。
  **实测**：实现里没有滚动百分比 / 进度类状态与读数（`grep -c scrollTop src/preview/endMarker.ts` = 0）；
  `git diff` 里没有 `overscroll-behavior` 与滚动行为改动。
- [x] 9.2 不修图片加载引起的文档高度变化，也不修任何滚动缺陷（含 M187 的 svg 滚动缺陷）。
  **实测**：`git diff --stat src/preview/attachments.ts` 为空；`src/preview/theme.ts` 的图片段（`.cm-lp-image*`）无改动；
  `docs/specs/image-reading.md` 未改。本 change 不解该缺陷（另立 finding 时再走 `docs/backlog.md`）。
- [x] 9.3 不新增配置项、不加键位、不加命令；不改既有渲染口径（分隔线、表格、frontmatter、图片宽度、空行折叠一律不动）。
  **实测**：`git diff src/keys.ts` 为空（无配置入口文件改动）；`src/preview/livePreview.ts` **零改动**（标记不进装饰层）；
  `src/preview/theme.ts` 的 diff 只新增标记段（原有规则一行未动）。
- [x] 9.4 已知边界如实记录：标记的观感（线段长短、留白）归 Alex，门禁只判几何与语义；判据在窗口高度跨越时随显随隐是预期行为；`design.md` §7 第 1 条的未验证项按 3.4 的实测结果如实落笔。
  **实测**：三项在 spec 的已知边界段与 design §7 各有对应文字；未验证项（CM 反应）已按 3.4 的实测结果改写为「无反应 + 机制依据 + 读数」，
  未写成「已验」；「不新增测量」的 1MB 端点读数如实标注为未测（占位口径），不宣称达标。
