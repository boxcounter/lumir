# Tasks: code-outline

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是
「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。**本 change 当前是提案**：全部任务未勾选，
实现待 Alex 节点 1 裁决后另立 mission。

**条件项（裁决落在备选上时先改写 delta 与本节，再实现，不静默按推荐项做）**：

- 裁决点 1 取「只支持少数语言」→ 1.3 的分层表的集合按裁决收窄，3.x 的逐语言断言同步收窄。
- 裁决点 1 取「T2 不做（css/scss 之外的键 / 元素也不做）」→ 3.2 与 5.x 的 T2 断言删除，delta 的分层表同步改。
- 裁决点 2 取「不新增依赖」→ 本 change 退回「只做 md 大纲」，1.2 之后的全部任务作废并按其口径改写 proposal。
- 裁决点 3 取「逐条与 md 同形」→ 4.4（跳转落点）与 4.2（层级）改回 md 口径，5.4 的落点断言同步改。
- 裁决点 3 取「打开即出现指示段」→ 5.1 追加「空闲时段预解析」实现与其截图门禁口径调整（含「指示段出现
  时机变成异步」的中间态处理）。
- 裁决点 5 取「顺带接 php」→ 1.3 的分层表增列 php，并把 php 的着色观感变化单独列为基线核对面。

## 1. 现状读数、依赖与语言分层（实现前先测）

- [ ] 1.1 复核现状读数：在 code 模式（受支持语言与 T3 语言各一份）里按 `⌘⇧O`，记录实际得到的条目数与
  提示文案。
  **验收口径**：读数落 `test-results/<mission>/code-outline-before/readings.json`（可 `ls`）；判据与本次
  提案的 [evidence/02](evidence/02-current-code-mode-readings.md) 一致（现状 = 0 条 + md 的空态提示）。
  **反向验证**：把「代码文件拿到 >0 条条目」写成断言，在实现前必须 FAIL。
- [ ] 1.2 逐包核对新增依赖的许可与体积，并把读数写进实现 PR。
  **验收口径**：`npm view <pkg> license version` 与 `npx esbuild --bundle --minify --format=esm
  --external:@lezer/lr --external:@lezer/common --external:@lezer/highlight --external:@codemirror/*
  outfile=<pkg>.js` 的输出落 `test-results/<mission>/deps/`（可 `ls`）；与 design §1.4 的表逐行对照，
  出现偏差即更新 design 的相应行（不许只改 PR 描述）。
- [ ] 1.3 在**单一来源**处建立语言分层注册表：键类型取 `CodeLanguage`（编译期穷尽检查），值与判据按
  design §1.3（T1 8 门 / T2 2 门 / T3 11 门）。
  **验收口径**：注册表处注释写明两条判据与逐门落位的依据（指向 design 与 evidence）；`tsc --noEmit`
  通过；对 T1/T2 每门语言各跑一次结构解析探针并留读数（证明该语法在本语料上产出声明节点）。
- [ ] 1.4 yaml 缺陷的复现读数与处置留档。
  **验收口径**：最小复现（空行 + 注释行 + `key: 1`）的输出落 `test-results/<mission>/yaml-defect.txt`；
  注册表里 yaml 在不支持档且注释写明理由；`docs/backlog.md` 有对应登记（若本 mission 未获授权写
  backlog，投 finding 给 tower）。

## 2. 结构解析与缓存（`src/code-structure.ts`）

- [ ] 2.1 实现解析触发与缓存：首次需要结构时解析一次、按文档缓存、换文件 / 外部重载 / 切标签失效。
  **验收口径**：单测或可执行的探针断言「同一 doc 第二次请求不产生新解析」（以计数或耗时读数为据）；
  换文件后计数递增。
- [ ] 2.2 打开路径零解析：打开一份受支持语言的 1MB 代码文件后不触发解析。
  **验收口径**：视觉场景里断言「打开后未发生解析」（探针计数为 0），随后按 `⌘⇧O` 才为 1；证据落
  `test-results/<mission>/code-outline-lazy.json`。
- [ ] 2.3 性能与内存读数（真机 / 产品端点，不是 headless 探针）：首次 `⌘⇧O` 的耗时、解析结果的常驻
  占用。
  **验收口径**：读数落 `test-results/<mission>/perf-*.json`，与 design §1.6 的 headless 下界对照；
  **不达标就写不达标**（不许用探针读数充当达标证据）。

## 3. 条目提取（类别 / 名字 / 层级 / 文本）

- [ ] 3.1 实现 T1 的声明节点 → 条目类别映射（`Record<CodeLanguage, …>` 形式，编译期穷尽检查）。
  **验收口径**：每门语言的固定语料断言「条目集合 == 预期集合」（含负向：局部变量、参数、导入行、
  表达式引用都不出现）；语料与断言表落 `test-results/<mission>/code-outline-cases.md`。
- [ ] 3.2 实现 T2 的规则集条目（css/scss）与 scss 的 `$变量`。
  **验收口径**：固定语料断言条目 = 规则集（嵌套规则各成一条）+ `$变量`，条目文本取选择器 / 名字；
  MUST NOT 收录属性声明。
- [ ] 3.3 名字口径逐语言写死（design §2.2 的实测差异：java 的第一个 `Definition`、c/cpp 的
  `InitDeclarator` 首个 `Identifier` 与 cpp 的 `FieldIdentifier`、python 的位置判据、rust 的
  `BoundIdentifier`/`TypeIdentifier`、go 的 `DefName`）。
  **验收口径**：每门语言至少一条「名字取错就会失败」的断言（例如 java 用返回类型当方法名、c 用第二个
  `Identifier` 当声明名，两种错法各写一条反向验证并留红灯证据）。
- [ ] 3.4 层级 = 语法嵌套深度、缩进归一、顺序 = 文档顺序。
  **验收口径**：断言深层与单层两份语料的层级数与缩进基准（`--toc-depth` 的实际取值）；把层级改成固定 0
  时断言 FAIL（反向验证留档）。
- [ ] 3.5 条目文本超长的省略号收尾与「取起始行原文」的回落路径（rust impl 块、css/scss 规则集）。
  **验收口径**：断言不渲染 markup、不做二次修复；长文本条目在浮层内以省略号收尾且不撑破浮层宽度。

## 4. 接线：指示段与浮层

- [ ] 4.1 `src/toc.ts` 的数据源分支（md 走既有 `extractHeadings` 逐字不动；code 走 `code-structure`）。
  **验收口径**：md 侧的全部既有断言零改动通过（`toc-outline.spec.ts` 的 md 用例逐条绿）；code 侧新断言
  覆盖两种来源。
- [ ] 4.2 指示段：code 模式的符号链、可见性四条件（有文件 / 链条非空 / 语言受支持且有条目 / 结构已解析）。
  **验收口径**：四条件各一条场景（含「结构未解析时不显示且不触发解析」）；断言「不引起文档区布局位移」。
- [ ] 4.3 浮层复用：打开 / 关闭 / 就地键 / 键位提示 / 当前段高亮 / 80% 总高上限。
  **验收口径**：`toc-outline.spec.ts` 的浮层用例（md）与新增代码用例逐条绿；断言两种模式下的键位提示文本
  逐字相同。
- [ ] 4.4 跳转落点 = 声明起点（不是 md 的行尾）。
  **验收口径**：断言 `view.state.selection.main.head === 声明的 from`（读 CM 选区，口径同既有
  `toc-outline.spec.ts`）；把落点改成行尾时断言 FAIL（反向验证留档）。
- [ ] 4.5 空态两条提示分流（无条目 / 语言不支持），且代码文件上不复用 D84。
  **验收口径**：两条断言各一条（文案与 deck 逐字一致）；把新文案换回 D84 原文时断言 FAIL。

## 5. 文案 deck

- [ ] 5.1 在 [文案-Copy.md](../../../文案-Copy.md) 追加两条空态提示（编号按末位顺延，当前 D114），并在
  文末「文案实现备注」段登记归属文件。
  **验收口径**：`tests/unit` 里按 deck 表格行逐字断言实现常量（两边漂移即红）；deck 的编号沿革段补一句
  本批来源。
- [ ] 5.2 复核 md 侧文案零变更（D84–D87 原样）。
  **验收口径**：`git diff 文案-Copy.md` 只含新增行，无既有行改动。

## 6. 单测（纯逻辑层）

- [ ] 6.1 把可纯化的部分抽出来加断言：条目类别映射、名字提取、层级计算、分层注册表的档位。
  **验收口径**：`node tests/unit/run.mjs` 全绿且新增用例数写进实现 PR；断言不依赖 DOM（`tests/unit/README.md`
  的分工）。
- [ ] 6.2 不把 DOM / 布局行为硬塞进单测层。
  **验收口径**：`git diff tests/unit/harness.ts` 为空（如需替身改动，先说明理由）。

## 7. 视觉场景（chromium，CI 门禁）

- [ ] 7.1 既有 `tests/visual/scenes/toc-outline.spec.ts` 的「非 md 文档不显示指示段」断言按新口径改写为
  「语言不受支持 / 无条目时不显示」，并保留一条「受支持语言 + 有条目时显示符号链」的正向断言。
  **验收口径**：改写后的断言在实现前对「符号链」这一条必须 FAIL（先红后绿）；负向断言不得空转
  （[REVIEW.md](../../../REVIEW.md) 第 2 条）。
- [ ] 7.2 新增代码大纲场景与 fixture（多门语言各一份：T1 至少 js/py/java 三种 + T2 的 css/scss + T3 的
  lua 一类），覆盖条目集合、缩进、落点、两种空态提示、浮层内在场。
  **验收口径**：断言是「条目文本序列 + 层级 + 选区落点 + 提示文案」这类可复算读数，不是「类名存在」；
  证据落 `test-results/<mission>/`。
- [ ] 7.3 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：逐张核对既有
  整页 / 元素级基线是否需要更新，新增浮层与符号链的元素级基线。
  **验收口径**：先给「逐张核对结论」清单（fixture 名 + 是否受影响 + 依据），再谈更新；`--update` 前
  截图须 Alex 过目（AGENTS.md 硬规则）。

## 8. 真机验收场景（WKWebView）

- [ ] 8.1 新增 `scripts/acceptance/scenarios/28-code-outline.md`（编号取现有最大 +1，实现时以
  `ls scripts/acceptance/scenarios/` 为准；若被占用则顺延），覆盖：受支持语言的条目与跳转、T3 语言的
  提示、md 侧口径不变。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过 + 真机跑一次 PASS，证据落
  `test-results/acceptance/<日期>/28-code-outline/`；断言避免依赖 AX 不暴露的东西（浮层条目文本以外的
  几何 / 颜色不进真机断言，口径同既有 13-toc 场景）。
- [ ] 8.2 真机反向验证：临时让某门语言的支持位失效（或让提取返回空），场景必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档，随后立即还原并重跑。
- [ ] 8.3 不改写源文件的真机判据：`editor.unchangedSince` + 磁盘文件 `unchangedSince` 两条断言在位且 PASS。
  **验收口径**：两条断言落在场景里（ADR 0003 §3）。

## 9. 验证与收官

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；
  `bash scripts/docs-check.sh` PASS。
  **验收口径**：日志落 `test-results/<mission>/gate-*.log`，`GATE RESULT` 行可引。
- [ ] 9.3 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读依赖须
  先经 tower 批准）。
- [ ] 9.4 收官对账：tasks 全部勾选（或标注放弃原因）；spec 增量与实现逐条对账（条目来源、分层、落点、
  空态、指示段可见性）；design §6 的未验证项按实现期实测结果改写（不许保留「未验」当「已验」）。
- [ ] 9.5 归档跟踪：在 `docs/backlog.md` 的「待 Alex 裁决」节落一条待归档记录（口径见
  [openspec-workflow.md](../../../docs/process/openspec-workflow.md) 的批次收尾 checklist）。

## 10. 已声明的边界 / 不做

- [ ] 10.1 不做文本级近似（正则 / 缩进 / 关键字扫描）：实现里 MUST NOT 出现按文档字符串提取条目的路径。
  **验收口径**：`rg` 检查实现模块里没有对 `doc` 做正则 / `indexOf` 的条目提取路径；反向验证按 §1.1。
- [ ] 10.2 不换着色管线：`src/preview/code.ts` 的语言表与 `TOKEN_GROUPS`、`src/editor.ts` 的 `codeHighlight`
  与围栏着色路径零改动。
  **验收口径**：`git diff src/preview/code.ts src/editor.ts` 只含注册表新增（若落点在这里），着色相关行零
  改动；`m120-code-highlight.spec.ts` 与 `render-codeblock.spec.ts` 全绿且逐条核对（不只看时间戳）。
- [ ] 10.3 不做 IDE 能力：无跳转定义 / 查找引用 / 符号搜索 / 跨文件索引 / 重命名。
  **验收口径**：实现里没有跨文件读取与符号数据库；`git diff` 不含新命令与新键位（`src/keys.ts` 零改动）。
- [ ] 10.4 不加配置项：不做「大纲显示 / 隐藏」开关。
  **验收口径**：`git diff src-tauri/src/config.rs` 为空；无新配置消费者。
