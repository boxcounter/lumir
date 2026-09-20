# Tasks: document-end-marker

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M188，2026-09-21）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是提案阶段的默认状态，不是「已实现未勾」。实现批次接手时按第 1 节起手，勾选时把证据指针补进本文件。

**条件项**：实现前先读 [proposal.md](proposal.md) 的「须提请 Alex 节点 1 裁决的选项」与「裁决记录」。裁决落在**推荐项**上时，本文件的默认写法（md 模式 / 短线夹字 / 按内容高度显示 / 不做内容探测）成立；落在备选上时，实现前先按裁决改写 delta 与本节条件项，不静默按推荐项做：

- 裁决点 1（文案）取备选③（无文字）→ 7.2 从「追加可见文案条目」改为「追加读屏名条目」，4.1 与 5.x 的文本断言改为 `aria-label` 断言。
- 裁决点 2（视觉形态）取任一备选 → 2.3 与 5.3 的形态断言按新形态改写（「短于栏宽一半 + 夹着文字」这两条判据随之改写，但「MUST NOT 与作者通栏分隔线同形」这条硬约束不放松）。
- 裁决点 3（出现形态）取备选①（常驻）→ 3.1 的判据作废、5.2 的两态断言改为「短文档也显示」，并追加一次基线重拍（AGENTS.md：基线更新先请 Alex 过目）；取备选②（滚到底才现）→ 3.1 改写为「占位恒定、只切换可见性」，并追加「滚动高度不受显隐影响」的断言。
- 裁决点 4（适用面）取备选①（md + code）→ 2.4 与 5.4 扩到 code 模式。

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 取一次**现状读数**：在一份超过一屏的 md 文档里滚到底，记录 ① 正文末尾没有任何元素（`.cm-content` 的最后一个子节点是最后一行）② 滚动容器的 `scrollHeight` 在顶部 / 中部 / 底部三次读数相同 ③ 滚到底前后界面上没有任何变化。
  **验收口径**：读数落 `test-results/acceptance/<日期>/document-end-marker-before/readings.json`（可 `ls`）；三项与 [design.md](design.md) §1–§3 的机制推断一致，或如实记录不一致的项并改设计（机制推断不是结论）。
- [ ] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条）：把「超过一屏的文档滚到底时标记可见（渲染盒宽高非零）」与「一屏装得下的文档没有标记」两条断言先写出来，在**未实现前**跑一次，两条都必须 FAIL。
  **验收口径**：红灯输出留档（playwright 失败信息）；没有这一步的绿灯不算数。
- [ ] 1.3 取一次**性能与几何基线**（3.2 / 8.2 的对照值）：打开 1MB Markdown 的现有端点读数（口径见 `perf-measurement` spec），以及 1.1 的三次 `scrollHeight` 数值。
  **验收口径**：读数落 1.1 的同一份 `readings.json`；3.2 与 8.2 复用同一读数对照，不另取。

## 2. 实现：标记本体

- [ ] 2.1 按 [design.md](design.md) §1 实现标记本体（推荐机制 = `.cm-content` 的生成内容；样式落 `src/preview/theme.ts`，该文件头明确 preview 装饰的样式在这里、不碰 `src/style.css`）。
  **验收口径**：`git diff src/style.css` 与 shell 级文件（`src/shell.ts`、`src/main.ts` 的浮层区）为空；标记的样式只命中新增的 class。
- [ ] 2.2 标记只进 md 模式的扩展束（`src/editor.ts:1180-1254` 的 md 分支）。
  **验收口径**：code 模式下 DOM 里没有标记节点（5.4 断言）；`git diff` 里非 md 分支的扩展集合未改。
- [ ] 2.3 形态按裁决点 2 的裁决实现（推荐项：居中短横线夹弱化小字；文字色 `--dim`、线段色 `--bd-2`；字体 `--font-display` + 字距）。
  **验收口径**：`grep -n "var(--accent)" ` 在标记相关规则里零命中；横向只用 `padding`（`grep -n "margin"` 在标记相关规则里零命中，[design.md](design.md) §1.3 第 4 条）；5.3 的「与分隔线可区分」断言 PASS。
- [ ] 2.4 标记 MUST NOT 从属显露口径：光标 / 选区落在文档末尾时标记照常显示。
  **验收口径**：5.4 断言 PASS（把光标放到最后一行、全选后再各读一次，标记都在场）。
- [ ] 2.5 标记 MUST NOT 参与文档：不进 `EditorState.doc`、不进保存字节。
  **验收口径**：5.5 的三条断言 PASS（复制文本、文件内搜索、磁盘逐字节）。

## 3. 实现：显示判据与几何稳定

- [ ] 3.1 按裁决点 3 的裁决实现判据（推荐项：文档内容高度 > 可用视口高度时显示；空文档、只有 frontmatter 的文档不显示；MUST NOT 读滚动位置）。
  **验收口径**：`grep -n "scrollTop"` 在实现里零命中（判据不读滚动位置）；判据的重算触发点写明在代码注释里（文档变更 / 视口尺寸变化）。**判据的测量须剔除标记自身的高度贡献**（或采用显示/隐藏阈值错开的迟滞，差值 ≥ 标记高度）——MUST NOT 直接拿含标记贡献的 `scrollHeight` 判（自我指涉，[design.md](design.md) §2 与 §7 第 5 条），剔除口径写进代码注释，并由 5.2 的临界带断言兜住。
- [ ] 3.2 几何稳定：标记的高度贡献与滚动位置无关；纵向间距用 `padding`、高度固定。
  **验收口径**：5.6 的「三次 `scrollHeight` 逐像素相同」断言 PASS；与 1.1 / 1.3 的读数对照。
- [ ] 3.3 不新增测量与解析：标记的建立与判定都是常量级，不遍历文档、不新增读取。
  **验收口径**：打开 1MB Markdown 的端点读数与 1.3 的基线对照（差异写进实现 PR）；如实记录，读数异常不宣称达标。
- [ ] 3.4 未验证项实测（[design.md](design.md) §7 第 1 条）：实测编辑器是否因标记改变 `.cm-content` 的尺寸而做出反应（滚动锚点复位一类）。
  **验收口径**：读数写明「有反应 / 无反应 / 读不出」；有反应则按 design §1 退回候选 B 机制并把实测记录写进 design。

## 4. 单测（`tests/unit`，纯逻辑层）

- [ ] 4.1 把可纯化的部分抽出来并加断言：显示判据（给定内容高度与视口高度 → 显示与否）与文案组装（把 deck 的串组装成标记文本）。
  **验收口径**：`node tests/unit/run.mjs`（= `pnpm test`）PASS，新增用例计入 `gate.sh` 的 `unit-tests` 行；新增用例数写进实现 PR。文案函数按 deck 表格行**逐字**断言（先例：`tests/unit/image-widget.test.ts` 对 D111–D113 的断言）。
- [ ] 4.2 不把 DOM / 布局行为硬塞进这一层（`tests/unit/README.md` 的分工：DOM 与布局归 visual）。
  **验收口径**：`git diff tests/unit/harness.ts` 为空（或在 PR 里说明为何必须扩替身）。

## 5. 视觉场景（chromium，CI 门禁）

- [ ] 5.1 新增场景 `tests/visual/scenes/<场景名>.spec.ts` 与 fixture（**三份文档**：内容超过一屏的、一屏装得下的、**内容高度恰好落在判据临界带内的**）+ 一个含作者手写 `---` 的组合输入面。1.2 的红灯在此转为绿。
  **验收口径**：判据是几何与文本读数，不是「class 存在」（[REVIEW.md](../../../REVIEW.md) 第 1 条）；红转绿的对照留档；临界带那份 fixture 的高度在实现 PR 里给出实测值（与可用视口高度、标记高度一起，证明它落在带内）。
- [ ] 5.2 两态断言：超过一屏 → 标记渲染盒宽高非零且居中；一屏装得下 → 标记不存在；再在同一场景里把文档补长（或压矮视口）→ 标记出现（配对正观测，[REVIEW.md](../../../REVIEW.md) 第 2 条：负向断言不得空转）。**覆盖缺口补一笔（M188 r1 P2-1）**：fixture 不能只取「明显装得下」与「明显装不下」两端，必须再有一份内容高度**恰好落在判据临界带内**（`clientHeight − 标记高度` 与 `clientHeight` 之间）——只取两端时，判据「拿含标记贡献的滚动高度去比」这个错误实现照样全绿。
  **验收口径**：三条各自可单独读出；「一屏装得下」那条的配对被显式断言；临界带那份 fixture 单独可读地断言「标记不存在」。**反向验证**：把判据临时改成直接读 `scrollHeight`（含标记贡献），临界带那条必须 FAIL，红灯留档（[design.md](design.md) §8 配方）。
- [ ] 5.3 形态与配色断言：线段总宽 < 阅读栏宽的一半、标记内存在文本节点、文字色 = `--dim`、线段色 = `--bd-2`；与同一文档里作者手写分隔线的通栏线在同一断言里对照。
  **验收口径**：反向验证——把标记的线改成通栏（临时改动）后本断言必须 FAIL，红灯留档。
- [ ] 5.4 md / code 与显露口径断言：同一份内容在 code 模式下没有标记；光标落在最后一行、全选后标记仍在场。
  **验收口径**：三条各自可单独读出。
- [ ] 5.5 非文档性断言：`⌘A` 复制得到的文本里没有标记的文案；文件内搜索标记文案无命中；`readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
  **验收口径**：反向验证——把标记临时实现成往文末插一行文本后本组必须 FAIL，红灯留档。
- [ ] 5.6 几何稳定断言：滚到顶 / 中 / 底三次读 `scrollDOM.scrollHeight`，三次逐像素相同。
  **验收口径**：反向验证——让标记随视口出现/消失（错误实现）后，接近底部那次必须读出更大值而 FAIL。
- [ ] 5.7 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：逐张核对 13 个像素基线场景是否需要更新。
  **验收口径**：用**内容判据**核对（`grep` 定位各场景 fixture，判断其内容是否超过一屏 / 是否含标记出现的条件），不能只看时间戳；推荐项下预期**零基线更新**，证据是 `gate.sh visual` 全绿 + 逐张核对说明；若需更新，先给 Alex 过目前的截图（基线更新是人肉裁决点）。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 6.1 **新增场景** `scripts/acceptance/scenarios/24-document-end-marker.md`（编号按现有最大 23 续；`item` 字段取 24），覆盖：打开超过一屏的文档 → 滚到底 → 标记可见；打开一屏装得下的文档 → 没有标记。
  **断言形态**：可见性 MUST NOT 只断言「AX 里有『到底了』这段文字」——不可见元素的 AX 文本照样读得到（`docs/backlog.md:293-304`，M178 finding），判据必须落在几何读数（节点行里的 `@x,y w×h` 宽高非零）或截图证据上。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 24` 真机 PASS，证据落 `test-results/acceptance/<日期>/24-document-end-marker/`（`status.txt` = PASS、`steps.md` 断言逐条可读）。
- [ ] 6.2 探针：先用一次探针确认标记在真实 WKWebView 的 AX 树里是否可读（生成内容是否进 AX）。
  **验收口径**：探针读数写进场景的 `steps.md`；不可读时改用截图证据 + chromium 层的几何断言，并在场景与实现 PR 里**如实标注覆盖边界**（不勾选时写明原因，MUST NOT 写「读不到即通过」，[REVIEW.md](../../../REVIEW.md) 第 2、6 条）。
- [ ] 6.3 场景 fixture 落 `scripts/acceptance/fixtures/`（两份 md：超过一屏的、一屏装得下的），与 md 一起进合成 vault。
  **验收口径**：场景 PASS 且 fixture 在场景头的 `fixtures:` 里逐条列名。
- [ ] 6.4 真机反向验证：把标记的渲染临时去掉（或回退到实现前代码）跑同一场景，断言必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` 与 `steps.md` 留档；没有这一步的 PASS 不算数。
- [ ] 6.5 不改写源文件的真机判据：`editor.unchangedSince`（编辑器内容）与磁盘文件的 `unchangedSince` 两条断言在位且 PASS（ADR 0003 §3）。
  **验收口径**：两条各占一条可单独读出的步骤，不合并且不省略。

## 7. 文案 deck

- [ ] 7.1 按裁决点 1 的裁决处置 [文案-Copy.md](../../../文案-Copy.md)：追加 D114 一行（末位当前 D113），中文与 English 两列都给，并在文末「文案实现备注」段登记归属文件（新条目按既有惯例在结尾补一句批次说明）。
  **验收口径**：`git diff 文案-Copy.md` 含 D114 一行 + 备注段一条；实现里的串与 deck 逐字一致（4.1 的断言即是这条判据）。
- [ ] 7.2 裁决点 1 取备选③（无文字）时：D114 登记为读屏名条目（与 D76「分隔线」同形），并核对 [foundation-markdown §5](../../../docs/specs/foundation-markdown.md) 的可访问性口径。
  **验收口径**：deck 条目形态与裁决一致；标记元素有可读名、不是匿名元素。

## 8. 验证与收官

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：输出末行 `Totals: 16 passed, 0 failed`（提案阶段实测值 = 14 份 living spec + 2 个活跃 change；实现 PR 合并时按当时的实际份数核对，不背口头值），且 `change/document-end-marker` 为 ✓。
- [ ] 8.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿（视觉侧按 AGENTS.md 的口径本地跑，CI 只跑结构层）；`bash scripts/docs-check.sh` PASS。
  **验收口径**：`GATE PASS` 逐行 + `GATE RESULT` 汇总；FAIL 项逐条修完再提交；日志落 `test-results/<mission>/`。
- [ ] 8.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **验收口径**：`test-results/acceptance/<日期>/summary.md` 里本场景为 PASS，报告里给可 `ls` 的绝对路径指针。
- [ ] 8.4 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读依赖须先报 tower 批准）。
  **验收口径**：改动集合落在 `src/preview/**`、`src/editor.ts`、`tests/**`、`scripts/acceptance/**`、`文案-Copy.md`、本 change 目录内；`git diff --stat src-tauri/` 为空。
- [ ] 8.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（逐 requirement 对一眼实现与断言）、living spec 归档另走节点 2。
  **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 list` 里本 change 状态与 tasks 勾选一致；delta 的每条 MUST 都能在实现或断言里指出落点。

## 9. 已声明的边界 / 不做

- [ ] 9.1 不做阅读进度读数（百分比 / 进度条 / 状态栏 / 剩余行数）；不做滚动行为改造（回弹抑制、吸附、`overscroll-behavior`）；不做「回顶」按钮、分页 / 懒加载；不做分节结束标记；不做字数 / 阅读时长。
  **验收口径**：实现里没有滚动百分比 / 进度类状态与读数（`grep` 指针写进 PR）；`git diff` 里没有 `overscroll-behavior` 与滚动行为相关改动。
- [ ] 9.2 不修图片加载引起的文档高度变化，也不修任何滚动缺陷（含 M187 的 svg 滚动缺陷）。
  **验收口径**：`git diff` 里 `src/preview/attachments.ts`、`src/preview/theme.ts` 的图片段、`docs/specs/image-reading.md` 均为空；实现 PR 的说明里明确「本 change 不解该缺陷」。若 dogfood 后确认该缺陷仍需处理，另立 finding（`docs/backlog.md`）。
- [ ] 9.3 不新增配置项、不加键位、不加命令；不改既有渲染口径（分隔线、表格、frontmatter、图片宽度、空行折叠一律不动）。
  **验收口径**：`git diff src/keys.ts`、`git diff src/config.ts`（或配置加载处）为空；`git diff src/preview/livePreview.ts` 的 diff 只含新增行，不含对既有分支的改动。
- [ ] 9.4 已知边界如实记录：标记的观感（线段长短、留白）归 Alex，门禁只判几何与语义；判据在窗口高度跨越时随显随隐是预期行为；`design.md` §7 第 1 条的未验证项按 3.4 的实测结果如实落笔。
  **验收口径**：三项在 spec 的已知边界段与实现 PR 的说明里各有一条对应文字；未验证项 MUST NOT 被写成「已验」。
