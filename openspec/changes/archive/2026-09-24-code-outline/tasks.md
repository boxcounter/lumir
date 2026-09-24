# Tasks: code-outline

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是
「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。**本 change 当前是提案**：全部任务未勾选，
实现待 Alex 节点 1 裁决后另立 mission。

**条件项（裁决落在备选上时先改写 delta 与本节，再实现，不静默按推荐项做）**：

- 裁决点 1 取「只支持少数语言」→ 1.3 的分层表的集合按裁决收窄，3.x 的逐语言断言同步收窄。
- 裁决点 1 取「T2 不做（css/scss 之外的键 / 元素也不做）」→ 3.2 与 5.x 的 T2 断言删除，delta 的分层表同步改。
- 裁决点 2 取「不新增依赖」→ 本 change 退回「只做 md 大纲」，1.2 之后的全部任务作废并按其口径改写 proposal。
- 裁决点 3 取「逐条与 md 同形」→ 4.4（跳转落点）与 4.2（层级）改回 md 口径，5.4 的落点断言同步改。
- 裁决点 7 取「打开即预解析」→ 5.1 追加「空闲时段预解析」实现与其截图门禁口径调整（含「指示段出现时机
  变成异步」的中间态处理）；4.2 的「不触发解析」断言改为「预解析发生但不在首帧」的口径。
- 裁决点 5 取「顺带接 php」→ 1.3 的分层表增列 php，并把 php 的着色观感变化单独列为基线核对面。
- 裁决点 6 取 S1 或 S3（换着色管线）→ 本 mission 停手上报：§1.5 的推荐、§1.6 的解析时机、§4 的模块落点与
  「着色 / parity / 基线零改动」这条结论全部作废，须按新机制重写 delta 与 tasks（含围栏侧 parity 与全量视觉
  基线重拍）。

## 1. 现状读数、依赖与语言分层（实现前先测）

- [x] 1.1 复核现状读数：在 code 模式（受支持语言与 T3 语言各一份）里按 `⌘⇧O`，记录实际得到的条目数与
  提示文案。
  **验收口径**：读数落 `test-results/<mission>/code-outline-before/readings.json`（可 `ls`）；判据与本次
  提案的 [evidence/02](evidence/02-current-code-mode-readings.md) 一致（现状 = 0 条 + md 的空态提示）。
  **反向验证**：把「代码文件拿到 >0 条条目」写成断言，在实现前必须 FAIL。
  **实现期**：`test-results/m197/code-outline-before/readings.json` —— code 模式 `.ts` / `.lua` 的
  `atxHeadingHits` 都是 **0**（max depth 1、节点名全是 token 类），对照组的 md 文档是 **2**（同一份
  `extractHeadings` 命中），即「实现前必须 FAIL」的那条断言在现场就是 FAIL。探针走的是**真模块**
  （`src/toc.ts` 的 `extractHeadings`，esbuild 打包后跑；`src/toc.ts` 依赖链含渲染 widget 的参数属性，
  node 的类型剥离跑不了）。
- [x] 1.2 逐包核对新增依赖的许可与体积，并把读数写进实现 PR。
  **验收口径**：`npm view <pkg> license version` 与 `npx esbuild --bundle --minify --format=esm
  --external:@lezer/lr --external:@lezer/common --external:@lezer/highlight --external:@codemirror/*
  outfile=<pkg>.js` 的输出落 `test-results/<mission>/deps/`（可 `ls`）；与 design §1.4 的表逐行对照，
  出现偏差即更新 design 的相应行（不许只改 PR 描述）。
  **实现期**：`test-results/m197/deps/{npm-view.txt,license-files.txt,sizes.txt}` —— 8 个包全 MIT、
  版本与 design §1.4 逐行一致；体积 min 合计 408.2KB / gzip 151.9KB（design 表 408.4 / 151.7，
  差异 <0.2%、来自 esbuild 版本与四舍五入）→ design §1.4 已补一行 M197 复测记录。
- [x] 1.3 在**单一来源**处建立语言分层注册表：键类型取 `CodeLanguage`（编译期穷尽检查），值与判据按
  design §1.3（T1 8 门 / T2 2 门 / T3 11 门）。
  **验收口径**：注册表处注释写明两条判据与逐门落位的依据（指向 design 与 evidence）；`tsc --noEmit`
  通过；对 T1/T2 每门语言各跑一次结构解析探针并留读数（证明该语法在本语料上产出声明节点）。
  **实现期**：`src/code-structure.ts` 的 `STRUCTURE_SUPPORT`（`Record<CodeLanguage, …>`，21 门逐门
  落位、T3 的 11 门逐门写明排除理由）；逐语言条目表落
  `test-results/m197/entries-by-language.txt`（每门语言一份固定语料 → 条目/类别/层级全量 dump），
  树形态读数落 `test-results/m197/probe/tree-*.txt`。
- [x] 1.4 yaml 缺陷的复现读数与处置留档。
  **验收口径**：最小复现（空行 + 注释行 + `key: 1`）的输出落 `test-results/<mission>/yaml-defect.txt`；
  注册表里 yaml 在不支持档且注释写明理由；`docs/backlog.md` 有对应登记（若本 mission 未获授权写
  backlog，投 finding 给 tower）。
  **实现期**：`test-results/m197/yaml-defect.txt` —— `@lezer/yaml@1.0.4` 在「空行 + 注释 + 区块映射」
  下产出 `Document [65536, 11)`（`iterate` 只见 2 个节点、`resolveInner` 落回 `Stream`），其余四种
  开头形态正常（对照逐行在案）。注册表里 yaml 为 `null` 且注释写明理由。**backlog 未写**：
  `docs/backlog.md` 不在本 mission 的改动范围，按本条既定出口投 finding 给 tower（见收官对账表）。

## 2. 结构解析与缓存（`src/code-structure.ts`）

- [x] 2.1 实现解析触发与缓存：首次需要结构时解析一次、按文档缓存、换文件 / 外部重载 / 切标签失效。
  **验收口径**：单测或可执行的探针断言「同一 doc 第二次请求不产生新解析」（以计数或耗时读数为据）；
  换文件后计数递增。
  **实现期**：`tests/unit/code-structure.test.ts` 的「同一文档第二次请求不重新解析；换文档（内容变化）
  重新解析」（计数断言，`structureParseCount()`）与「peek 不解析：未解析的文档返回 null」。缓存键是
  「语言 + 文档原文」——code 模式只读，内容即身份；换文件 / 外部重载 / 切标签都会带来新键。
- [x] 2.2 打开路径零解析：打开一份受支持语言的 1MB 代码文件后不触发解析。
  **验收口径**：视觉场景里断言「打开后未发生解析」（探针计数为 0），随后按 `⌘⇧O` 才为 1；证据落
  `test-results/<mission>/code-outline-lazy.json`。
  **实现期（偏离，逐条申报）**：判据改成**同位置的行为对照**，不是产品里暴露一个解析计数器——
  ① 打开后把光标放进类内方法体，指示段必须仍旧隐藏（结构未解析 ⇒ 链条条件不成立；「打开即解析」的
  实现会在这里红）；② 同一光标位置按一次 `⌘⇧O` 之后指示段当场显示 `Util › greet`（同一位置、同一
  文档，唯一变量是「解析发生过」）。解析**次数**的断言在 `tests/unit`（`structureParseCount()`）拿到，
  读数落 `test-results/m197/code-outline-lazy.json`。理由：产品代码里加一个只为测试存在的计数器全局
  是本仓没有的模式（视觉场景的观测通道一直是 IPC 桩），而「指示段在未解析时不显示」是 spec 自己的
  判据，行为对照与 design §5 的反向验证配方逐条对应。
- [x] 2.3 性能与内存读数（真机 / 产品端点，不是 headless 探针）：首次 `⌘⇧O` 的耗时、解析结果的常驻
  占用。
  **验收口径**：读数落 `test-results/<mission>/perf-*.json`，与 design §1.6 的 headless 下界对照；
  **不达标就写不达标**（不许用探针读数充当达标证据）。
  **实现期**：读数与口径见 `test-results/m197/perf-memory.json` 与
  `test-results/m197/perf-first-outline.json`（真机 debug 实例 + 隔离 vault，RSS 合计口径同
  `scripts/perf/memory.mjs`）；结论（含不达标项的如实写法）抄在收官对账表里。

## 3. 条目提取（类别 / 名字 / 层级 / 文本）

- [x] 3.1 实现 T1 的声明节点 → 条目类别映射（`Record<CodeLanguage, …>` 形式，编译期穷尽检查）。
  **验收口径**：每门语言的固定语料断言「条目集合 == 预期集合」（含负向：局部变量、参数、导入行、
  表达式引用都不出现）；语料与断言表落 `test-results/<mission>/code-outline-cases.md`。
  **实现期**：8 门语言各一条 `deepEqual(条目快照)` 断言 + 逐门负向清单（`tests/unit/code-structure.test.ts`）；
  语料与预期集合的现场 dump 落 `test-results/m197/entries-by-language.txt`（对应本条要的
  `code-outline-cases.md`）。类别词表按 delta 的逐语言覆盖表实现——design §2.1 的 `module`（命名空间）
  在 delta 里没有任何消费者，按 [REVIEW.md](../../../../REVIEW.md) 第 9 条**不收进实现**（见收官对账表的
  偏离申报）。
- [x] 3.2 实现 T2 的规则集条目（css/scss）与 scss 的 `$变量`。
  **验收口径**：固定语料断言条目 = 规则集（嵌套规则各成一条）+ `$变量`，条目文本取选择器 / 名字；
  MUST NOT 收录属性声明。
  **实现期**：`tests/unit/code-structure.test.ts` 的 css / scss 两条 + 视觉场景 `code-outline.spec.ts`
  的 T2 用例（含 `--toc-depth`）。scss 的 `$变量`判据是**首个子节点是 `SassVariableName`**——按「有
  这个子节点」判时 `padding: $gap;` 会多出一条重复条目（实现期实测踩到，反例写进单测注释）。
- [x] 3.3 名字口径逐语言写死（design §2.2 的实测差异：java 的第一个 `Definition`、c/cpp 的
  `InitDeclarator` 首个 `Identifier` 与 cpp 的 `FieldIdentifier`、python 的位置判据、rust 的
  `BoundIdentifier`/`TypeIdentifier`、go 的 `DefName`）。
  **验收口径**：每门语言至少一条「名字取错就会失败」的断言（例如 java 用返回类型当方法名、c 用第二个
  `Identifier` 当声明名，两种错法各写一条反向验证并留红灯证据）。
  **实现期**：`tests/unit/code-structure.test.ts` 的「名字口径：取错就会失败的四处形态」（java 返回
  类型 / c 第二个 Identifier / python 位置 / rust impl 行原文）+ go 的接收者 vs 方法名。名字口径在
  `src/code-structure.ts` 的 `NameRule` 里做成 7 个变体，逐变体写明它的消费语言与实测依据。
- [x] 3.4 层级 = 语法嵌套深度、缩进归一、顺序 = 文档顺序。
  **验收口径**：断言深层与单层两份语料的层级数与缩进基准（`--toc-depth` 的实际取值）；把层级改成固定 0
  时断言 FAIL（反向验证留档）。
  **实现期**：单测「层级 = 语法嵌套深度」+ 视觉场景的 `--toc-depth` 断言（`["0","0","1","1","0"]`）。
  反向验证：把提取的 `depth` 改成固定 0 → 9 条断言红，现场落
  `test-results/m197/reverse-verification/depth-fixed-zero.log`（随后还原并复跑绿）。
  缩进归一由 `src/toc.ts` 的 `render()` 一处实现（md 与 code 共用）。
- [x] 3.5 条目文本超长的省略号收尾与「取起始行原文」的回落路径（rust impl 块、css/scss 规则集）。
  **验收口径**：断言不渲染 markup、不做二次修复；长文本条目在浮层内以省略号收尾且不撑破浮层宽度。
  **实现期**：起始行原文（去缩进、去行尾 `{`）/ 选择器原文两种口径在单测里逐条断言（`impl Util`、
  `impl fmt::Display for Util`、`.a, .b > .c:hover`、`&:hover`）；省略号收尾由既有
  `.lumir-toc-item`（`white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`）承担，
  **样式零改动即为该判据的实现**（`src/style.css` 本次未动，`git diff` 可核）。


## 4. 接线：指示段与浮层

- [x] 4.1 `src/toc.ts` 的数据源分支（md 走既有 `extractHeadings` 逐字不动；code 走 `code-structure`）。
  **验收口径**：md 侧的全部既有断言零改动通过（`toc-outline.spec.ts` 的 md 用例逐条绿）；code 侧新断言
  覆盖两种来源。
  **实现期**：`src/toc.ts` 引入统一的 `OutlineItem`（文本 / 层级量 / 起点 / 落点 / 行号）——md 的标题与
  code 的符号各自适配成它，渲染 / 导航 / 跳转**只有一份实现**；`extractHeadings` 逐字未动。
  `toc-outline.spec.ts` **零改动**且逐条绿（全量视觉 run 的日志为证）。
- [x] 4.2 指示段：code 模式的符号链、可见性四条件（有文件 / 链条非空 / 语言受支持且有条目 / 结构已解析）。
  **验收口径**：四条件各一条场景（含「结构未解析时不显示且不触发解析」）；断言「不引起文档区布局位移」。
  **实现期**：视觉场景第 1 条的 ①②⑤ 三步覆盖「未解析 ⇒ 隐藏」「位置在条目前 ⇒ 隐藏」「解析后同位置
  ⇒ 显示」；`hasFile` / 语言受支持两条判据沿用既有代码路径（`hasFile()` + `supportsStructure()`）。
  「不引起布局位移」由既有 `.masthead-section[hidden]` 与浮层绝对定位承担（本次零样式改动）。
- [x] 4.3 浮层复用：打开 / 关闭 / 就地键 / 键位提示 / 当前段高亮 / 80% 总高上限。
  **验收口径**：`toc-outline.spec.ts` 的浮层用例（md）与新增代码用例逐条绿；断言两种模式下的键位提示文本
  逐字相同。
  **实现期**：浮层 DOM / 就地键 / 提示串一处未改（`src/toc.ts` 的 `POPOVER_HINT` 等常量原样）；新增的
  code 用例断言 `.lumir-toc-hint` 文本与 md 侧逐字相同，`is-current` 落在光标所在符号上。
- [x] 4.4 跳转落点 = 声明起点（不是 md 的行尾）。
  **验收口径**：断言 `view.state.selection.main.head === 声明的 from`（读 CM 选区，口径同既有
  `toc-outline.spec.ts`）；把落点改成行尾时断言 FAIL（反向验证留档）。
  **实现期**：视觉场景断言 `caret().head === JS_DOC.indexOf("class Util")`（键盘 Enter 与鼠标点击两条
  路径），并附一条「落点严格早于该行行尾」。反向验证：把 code 侧落点改成 `entry.to`（≈ 声明末尾，
  行尾口径的同族错法）→ 该用例红，现场落
  `test-results/m197/reverse-verification/visual-jump-line-end.log`（随后还原）。
- [x] 4.5 空态两条提示分流（无条目 / 语言不支持），且代码文件上不复用 D84。
  **验收口径**：两条断言各一条（文案与 deck 逐字一致）；把新文案换回 D84 原文时断言 FAIL。
  **实现期**：`NO_SYMBOLS_TEXT` / `NO_STRUCTURE_TEXT` 两个常量（`src/toc.ts`），视觉场景两条用例各断言
  一条文案 + 与 D84/另一条互斥。反向验证：把 `NO_SYMBOLS_TEXT` 换回 D84 原文 → 该用例红，现场落
  `test-results/m197/reverse-verification/visual-toast-d84-reused.log`。文案措辞以 **delta spec** 为准
  （「这份文件类型暂不支持大纲」），design §2.4 / §3.2 的旧措辞已同步改准。

## 5. 文案 deck

- [x] 5.1 在 [文案-Copy.md](../../../../文案-Copy.md) 追加两条空态提示（编号按末位顺延，当前 D114），并在
  文末「文案实现备注」段登记归属文件。
  **验收口径**：`tests/unit` 里按 deck 表格行逐字断言实现常量（两边漂移即红）；deck 的编号沿革段补一句
  本批来源。
  **实现期（偏离，逐条申报）**：`文案-Copy.md` 不在本 mission 的改动范围（scope 只含 src / tests /
  scripts/acceptance / change 目录），因此**deck 未写入**，改为：① 两条待补的 deck 行**逐字**记在本条下
  （见下表），由 tower 路由到 deck 的维护者；② 实现常量在 `src/toc.ts`，
  `tests/unit/code-structure.test.ts`… 见下条说明的断言口径。**待补 deck 行**：

  | 编号 | 中文 | English | 位置 | 设计意图 |
  |---|---|---|---|---|
  | D115 | 这份文件没有可提取的符号，大纲为空 | No extractable symbols in this file; the outline is empty | 作者 | code 模式下受支持语言但文件里没有条目时的提示；与 D84（md 无标题）区分——代码文件没有「标题」这回事 |
  | D116 | 这份文件类型暂不支持大纲 | This file type does not support the outline yet | 作者 | code 模式语言不在结构解析分层表里时的提示（含 yaml / shell / sql / lua 等 11 门 T3 语言与无语言包的扩展） |

  两条文案的「两边漂移即红」在 deck 未补之前由**视觉场景与真机场景各一条逐字断言**担当（`文案` 与实现
  常量的漂移会让场景红）；补 deck 时须把本表两行原样搬进去（措辞以 delta spec 为准）。
- [x] 5.2 复核 md 侧文案零变更（D84–D87 原样）。
  **验收口径**：`git diff 文案-Copy.md` 只含新增行，无既有行改动。
  **实现期**：`git diff 文案-Copy.md` **完全为空**（本 mission 未动该文件）；D84–D87 的常量在
  `src/toc.ts` 里原样。

## 6. 单测（纯逻辑层）

- [x] 6.1 把可纯化的部分抽出来加断言：条目类别映射、名字提取、层级计算、分层注册表的档位。
  **验收口径**：`node tests/unit/run.mjs` 全绿且新增用例数写进实现 PR；断言不依赖 DOM（`tests/unit/README.md`
  的分工）。
  **实现期**：新增 `tests/unit/code-structure.test.ts`，**22 条用例**（r1 评审的两条 P2 修复各补一条：
条目跨度 `to` 断言、缓存键不重建的计数断言）；全套 **144 pass / 0 fail**
  （基线 122 → 新增 20）。「当前位置归属 + 祖先链」的算法（`itemIndexAt` / `itemPath`）也在本层断言
  ——它被移到 `src/code-structure.ts` 正是为了可被本层直接覆盖（`src/toc.ts` 的依赖链含 DOM 侧模块）。
- [x] 6.2 不把 DOM / 布局行为硬塞进单测层。
  **验收口径**：`git diff tests/unit/harness.ts` 为空（如需替身改动，先说明理由）。
  **实现期**：`tests/unit/harness.ts` 与 `run.mjs` / `hooks.mjs` / `register.mjs` 均零改动（`git status`
  只多出新增的 `code-structure.test.ts`）。

## 7. 视觉场景（chromium，CI 门禁）

- [x] 7.1 既有 `tests/visual/scenes/toc-outline.spec.ts` 的「非 md 文档不显示指示段」断言按新口径改写为
  「语言不受支持 / 无条目时不显示」，并保留一条「受支持语言 + 有条目时显示符号链」的正向断言。
  **验收口径**：改写后的断言在实现前对「符号链」这一条必须 FAIL（先红后绿）；负向断言不得空转
  （[REVIEW.md](../../../../REVIEW.md) 第 2 条）。
  **实现期（偏离，逐条申报）**：本条的**前提不成立**——现状仓里没有「非 md 文档不显示指示段」这条断言
  （`rg masthead-section tests/` 只命中 `toc-outline.spec.ts` 的三处 md 用例，没有非 md 用例；
  proposal 的 Impact 节与 design 都没写过它，是 tasks 起草时的推断）。处置：在**新增场景**里把两个方向
  都补上（「语言不受支持 / 无条目时不显示」两条负向 + 「受支持语言 + 有条目时显示符号链」一条正向，
  后者用 `.masthead-section` 的文本断言 `Util › greet`），`toc-outline.spec.ts` **零改动**。
- [x] 7.2 新增代码大纲场景与 fixture（多门语言各一份：T1 至少 js/py/java 三种 + T2 的 css/scss + T3 的
  lua 一类），覆盖条目集合、缩进、落点、两种空态提示、浮层内在场。
  **验收口径**：断言是「条目文本序列 + 层级 + 选区落点 + 提示文案」这类可复算读数，不是「类名存在」；
  证据落 `test-results/<mission>/`。
  **实现期**：新增 `tests/visual/scenes/code-outline.spec.ts`，**6 条用例**（惰性解析 / 跳转落点 /
  T2 规则集 / T3 提示 / 无条目提示 / md 对照）。T1 覆盖 js 与 py（java 的类别与嵌套由单测按固定语料
  逐条断言；真机场景用 js）；断言全是「条目文本序列 + `--toc-depth` 数组 + 选区 head/line + toast 文案」
  这类可复算读数。run 日志落 `test-results/m197/visual-*.log`。
- [x] 7.3 基线核对（[REVIEW.md](../../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：逐张核对既有
  整页 / 元素级基线是否需要更新，新增浮层与符号链的元素级基线。
  **验收口径**：先给「逐张核对结论」清单（fixture 名 + 是否受影响 + 依据），再谈更新；`--update` 前
  截图须 Alex 过目（AGENTS.md 硬规则）。
  **实现期**：逐张核对清单落 `test-results/m197/baseline-check.md`；**既有基线零差异**（M197 时点既有
  基线 32 张，sha256 与 master 逐字节相同；基线文件的实际命名是 `*-chromium-darwin.png`——本表原写的
  「40 张 `*-expected.png`」两处都不成立，归档时按 `baseline-check.md` 的逐张表改准；
  `toc-outline.spec.ts-snapshots` 的两张元素基线也在其中）。**新增 1 张元素级基线**（只增不改）：
  `tests/visual/baselines/code-outline.spec.ts-snapshots/code-outline-popover-chromium-darwin.png`
  ——「待 Alex 过目」这一点已由 M199 结清（`03ca450` 按「Alex 过目口径：合并指示即通过」重拍四张浮层
  元素基线，本张 sha `66b9bbb7…` → `352ba101…`），四张浮层基线的人工裁决点现由 `docs/backlog.md`
  条目 23 承载（截图要点：5 条条目、`field`/`greet` 缩进一级、当前段 `greet` 加粗、底部键位提示与
  md 侧同一行文案）。


## 8. 真机验收场景（WKWebView）

- [x] 8.1 新增 `scripts/acceptance/scenarios/28-code-outline.md`（编号取现有最大 +1，实现时以
  `ls scripts/acceptance/scenarios/` 为准；若被占用则顺延），覆盖：受支持语言的条目与跳转、T3 语言的
  提示、md 侧口径不变。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过 + 真机跑一次 PASS，证据落
  `test-results/acceptance/<日期>/28-code-outline/`；断言避免依赖 AX 不暴露的东西（浮层条目文本以外的
  几何 / 颜色不进真机断言，口径同既有 13-toc 场景）。
  **实现期（编号按实测就地标注）**：编号取 **30**（`ls scripts/acceptance/scenarios/` 的最大值是 29）
  ⇒ 文件是 `scripts/acceptance/scenarios/30-code-outline.md`，证据目录
  `test-results/acceptance/2026-09-24/30-code-outline/`（抄件 `test-results/m197/acceptance-30-evidence/`）。
  `--check` PASS（37 个场景全过）；真机 **PASS 1/1（47.3s）**，日志
  `test-results/m197/acceptance-30-run4-restored.log`（收官轮的日志；前三轮的现场与教训见下条）。
  **md 侧口径不变**由既有 `13-toc` 场景担当（同一批次、同一枚二进制、同一条共用通道）——本场景不
  复刻 md 的键盘注入步骤（每个 chord 都是盲发，步骤越少越稳）。
  **三轮 FAIL 的现场（如实记录，都是场景自身的问题，不是产品缺陷）**：
  ① run1：步骤按「五条条目（含 helper）」设计，而 fixture 只写了四条（LIMIT / Util / field / greet）
  ⇒ 断言与语料不一致；同时该轮暴露了两个 AX 形态事实（见下条 8.2 的说明与场景正文）。
  ② run2：**我自己在跑的过程中改了 `src/toc.ts`**，vite dev 的 HMR 把前端热重载了 ⇒ 场景后半程
  「无当前文件」、编辑器文本清空。教训：真机批次进行中 MUST NOT 动 `src/**`（HMR 不在套件的隔离
  范围内）——已写进本条的现场记录。
  ③ run3 起 PASS（同一场景、同一份代码）。
- [x] 8.2 真机反向验证：临时让某门语言的支持位失效（或让提取返回空），场景必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档，随后立即还原并重跑。
  **实现期**：把 `STRUCTURE_SUPPORT.javascript` 临时置空（`src/code-structure.ts`）⇒ 场景
  **FAIL，13 条断言红**（浮层不再展开、条目表与指示段的链全部落空，唯一通过的是两条 toast 相关的
  负向断言——它们本来就没依赖浮层）。FAIL 的 `status.txt` / `steps.md` / run 日志抄件落
  `test-results/m197/reverse-verification/acceptance-javascript-nulled{,-status.txt,-steps.md}`；
  还原后（`grep` 已核）重跑 ⇒ **PASS 1/1**（`acceptance-30-run4-restored.log`）。
  **顺带定下的两条 AX 形态事实**（写进场景正文，供后续场景复用）：指示段是
  `AXButton (›<链>) help="点击展开大纲"`（`›` 来自 `src/style.css:489` 的 `::before`，也会进 AX 名）；
  浮层条目是 `AXList (大纲)` 下的逐条 `AXStaticText (<条目文本>)`。**其中「游标所在那条带 `(focused)`」
  这条事实已过期**（M199 起）：筛选输入框接管焦点后 `(focused)` 落在输入框（`AXComboBox`）上、条目不再
  带任何标记，游标落点因此一律改用派生证据（Enter 跳转后的指示段链条）。场景正文已按此改写，见
  `scripts/acceptance/scenarios/30-code-outline.md` 的「浮层条目的 AX 形态」一节。
- [x] 8.3 不改写源文件的真机判据：`editor.unchangedSince` + 磁盘文件 `unchangedSince` 两条断言在位且 PASS。
  **验收口径**：两条断言落在场景里（ADR 0003 §3）。
  **实现期**：两条都在（跳转后的那一步），且都 PASS：编辑器「104 字节逐字节一致」、磁盘
  `sha256 d8da044ae743` 不变；第二次跳转之后又断言了一次编辑器逐字节不变。

## 9. 验证与收官

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **实现期**：`gate.sh quick` 的 `openspec-validate` 一条 PASS（3s）——`test-results/m197/gate-quick.log`。
- [x] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；
  `bash scripts/docs-check.sh` PASS。
  **验收口径**：日志落 `test-results/<mission>/gate-*.log`，`GATE RESULT` 行可引。
  **实现期**：`test-results/m197/gate-quick.log` —— **`GATE RESULT: 10/10 PASS（SKIP 0）`**（cargo-fmt /
  clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / tsc-unit / unit-tests / docs-check /
  openspec-validate）；`test-results/m197/gate-visual.log` —— `LUMIR_VISUAL_PORT=4297`（隔离端口，避开
  4173 与别的 worktree）的整轮结果见该日志的 `GATE RESULT` 行。
- [x] 9.3 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读依赖须
  先经 tower 批准）。
  **实现期**：`git diff --check` 干净（无空白错误）；改动文件 15 个：`src/code-structure.ts`（新）、
  `src/toc.ts`、`src/main.ts`、`package.json`、`pnpm-lock.yaml`、`tests/unit/code-structure.test.ts`（新）、
  `tests/visual/scenes/code-outline.spec.ts`（新）+ 新增 1 张元素级基线、
  `scripts/acceptance/scenarios/30-code-outline.md`（新）+ 3 个 fixture（新）、change 目录四件
  （proposal / design / tasks 三件有改动，specs 增量未改）。**与 Impact 清单一致**：`src/preview/code.ts`
  与 `src/editor.ts` 零改动（着色管线）、`src/style.css` 零改动（沿用既有浮层样式）、
  `src-tauri/**` 零改动、`文案-Copy.md` 与 `docs/backlog.md` 零改动（两条越 scope 的登记各投 finding）。
- [x] 9.4 收官对账：tasks 全部勾选（或标注放弃原因）；spec 增量与实现逐条对账（条目来源、分层、落点、
  空态、指示段可见性）；design §6 的未验证项按实现期实测结果改写（不许保留「未验」当「已验」）。
  **实现期**：见本文件末尾的「收官对账表」；design §6 的未验证项已按实测改写（见该节的实现期注）。
- [x] 9.5 归档跟踪：在 `docs/backlog.md` 的「待 Alex 裁决」节落一条待归档记录（口径见
  [openspec-workflow.md](../../../../docs/process/openspec-workflow.md) 的批次收尾 checklist）。
  **实现期（偏离）**：`docs/backlog.md` 不在本 mission 的改动范围 ⇒ 未写；已投 finding 请 tower 路由
  （与 1.4 的 yaml 上游缺陷登记同一条 finding：`docs/backlog.md` 待补两条）。

## 10. 已声明的边界 / 不做

- [x] 10.1 不做文本级近似（正则 / 缩进 / 关键字扫描）：实现里 MUST NOT 出现按文档字符串提取条目的路径。
  **验收口径**：`rg` 检查实现模块里没有对 `doc` 做正则 / `indexOf` 的条目提取路径；反向验证按 §1.1。
  **实现期**：`test-results/m197/task10-boundaries.md` —— `rg "\.match\(|\.exec\(|indexOf\(|split\(|replace\("`
  在 `src/code-structure.ts` 只有 3 处命中，逐处归因都是「行号计算」与 design §2.2 明文规定的
  「无名条目取起始行原文 / 选择器部分」收尾；条目的唯一来源是分层表 + 语法树遍历。
  反向验证：改成正则扫 `function` 行 ⇒ 15 条断言红（`reverse-verification/regex-extraction.log`）。
- [x] 10.2 不换着色管线：`src/preview/code.ts` 的语言表与 `TOKEN_GROUPS`、`src/editor.ts` 的 `codeHighlight`
  与围栏着色路径零改动。
  **验收口径**：`git diff src/preview/code.ts src/editor.ts` 只含注册表新增（若落点在这里），着色相关行零
  改动；`m120-code-highlight.spec.ts` 与 `render-codeblock.spec.ts` 全绿且逐条核对（不只看时间戳）。
  **实现期**：两个文件 `git diff` 为空（注册表落在新文件里）；两个场景全绿（`gate-visual.log`），且
  它们的 **10 张整页基线逐字节零差异**（`baseline-check.md`）——「逐条核对」的口径用基线哈希，不用时间戳。
- [x] 10.3 不做 IDE 能力：无跳转定义 / 查找引用 / 符号搜索 / 跨文件索引 / 重命名。
  **验收口径**：实现里没有跨文件读取与符号数据库；`git diff` 不含新命令与新键位（`src/keys.ts` 零改动）。
  **实现期**：`git diff src/keys.ts src-tauri/src/config.rs` 为空；`src/code-structure.ts` 里
  `rg "readTextFile|fs_read|invoke|fetch\("` 无命中（不读文件、不发 IPC、无符号数据库）。
- [x] 10.4 不加配置项：不做「大纲显示 / 隐藏」开关。
  **验收口径**：`git diff src-tauri/src/config.rs` 为空；无新配置消费者。
  **实现期**：同上（零改动）；实现里没有新增任何开关或字段。

---

## 收官对账表（tasks → 实现 → 证据）

| 组 | 状态 | 一句话对账 | 证据指针 |
|---|---|---|---|
| 1 现状读数 / 依赖 / 分层（含 1.4 yaml） | ✅ | 现状 0 条（真模块读数）；8 包全 MIT、体积与 design §1.4 一致（补一行复测记录）；分层表 21 门逐门落位；yaml 缺陷独立复现 | `code-outline-before/readings.json`、`deps/`、`entries-by-language.txt`、`yaml-defect.txt` |
| 2 解析与缓存 | ✅ | 惰性（打开/光标零解析）、按「语言 + 原文」缓存、换文档重建；真机端点首次解析 **177.0ms**（1MB）、第二次不解析；常驻内存读数如实记（**不宣称达标**） | `code-outline-lazy.json`、`perf-first-outline.json`、`perf-memory.json` |
| 3 条目提取 | ✅ | 逐语言条目集合 + 名字口径 + 层级 + 两种无名回落；含负向清单 | `code-outline-cases.md`、`tests/unit/code-structure.test.ts`、`entries-by-language.txt` |
| 4 接线（指示段 / 浮层 / 落点 / 空态） | ✅ | 统一条目模型、md 分支逐字不动；落点 = 声明起点；两条新提示与 D84 互斥 | `tests/visual/scenes/code-outline.spec.ts`、`30-code-outline.md` |
| 5 文案 deck | ⚠️ 偏离 | 实现常量就位 + 视觉/真机各一条逐字断言；**deck 未补登**（越 scope）⇒ 已投 finding | tasks.md 5.1 的两行待补表 + finding `…copy-md-d115-d116…` |
| 6 单测 | ✅ | 新增 22 条，全套 144 pass / 0 fail；`harness.ts` 零改动 | `gate-quick.log`（r1 后为 `gate-quick-r2.log`）的 unit-tests |
| 7 视觉场景与基线 | ✅ | 新增 6 条用例；既有基线 32 张逐字节零差异；新增 1 张（待 Alex 过目） | `tests/visual/scenes/code-outline.spec.ts`、`baseline-check.md` |
| 8 真机验收 | ✅ | 场景 30 PASS 1/1；反向验证 13 条红后还原重跑 PASS；`unchangedSince` 两条在位 | `acceptance-30-run4-restored.log`、`acceptance-30-evidence/`、`reverse-verification/` |
| 9 验证与收官 | ✅ | quick 10/10、visual 见 `gate-visual.log`、docs-check PASS、openspec validate PASS、`git diff --check` 干净 | `gate-quick.log`、`gate-visual.log` |
| 10 边界 / 不做 | ✅ | 无文本近似、着色管线零改动、无 IDE 能力、无新配置项 | `task10-boundaries.md` |

**spec 增量逐条对账**（`toc-outline` 的 MODIFIED/ADDED 与 `editor-live-preview` 的 ADDED）：

| spec 条款 | 实现落点 | 判据 |
|---|---|---|
| 条目数据来源 = 结构解析树，MUST NOT 正则/缩进/文本匹配 | `src/code-structure.ts` 的 `STRUCTURE_SUPPORT` + `collectEntries` | 10.1 的 `rg` 归因 + 正则实现的反向验证（15 条红） |
| 语言分层（T1 8 门 / T2 2 门 / T3 11 门） | `STRUCTURE_SUPPORT`（编译期穷尽检查） | 单测「分层注册表的键与既有语言表一一对应」+ T3 逐门断言 |
| 条目文本（名字子节点 / 无名条目起始行 / 选择器） | `resolveEntries` + `lineText` / `selectorText` | 单测逐语言断言 + 视觉场景的条目文本序列 |
| 层级 = 语法嵌套深度、缩进归一、顺序 = 文档顺序 | `depth` 字段 + `render()` 的 `--toc-depth` 归一 | 单测层级断言 + 视觉场景 `["0","0","1","1","0"]`；反向验证（固定 0）9 条红 |
| 跳转落点 = 声明起点、不改文档 | `OutlineItem.jumpTo`（code 取 `entry.from`）+ `jumpTo()` 只 dispatch selection/scrollIntoView | 视觉场景读 CM 选区断言字符偏移；真机 `unchangedSince` 两条 |
| 空态两条提示分流、不复用 D84 | `NO_SYMBOLS_TEXT` / `NO_STRUCTURE_TEXT` | 视觉场景两条用例 + 真机两条用例；反向验证（换回 D84）红 |
| 指示段可见性四条件（有文件 / 链条非空 / 语言受支持且有条目 / 结构已解析） | `sync()` + `indicatorItems()`（`peekStructureEntries`） | 视觉场景三步 + 真机两步（同一条正则的前后对照） |
| 指示段 MUST NOT 为点亮它而触发解析 | `indicatorItems()` 只调 `peekStructureEntries` | 反向验证（改成 `structureEntries`）红 |
| 着色管线 MUST NOT 改变（parity 不变量） | `src/preview/code.ts` / `src/editor.ts` 零改动 | 两文件 `git diff` 空 + 10 张基线逐字节零差异 + 两个场景全绿 |
| 解析时机与缓存（首次需要才解析、同文档不重解、换文件失效） | `structureEntries` / `peekStructureEntries` + 缓存 | 单测计数断言 + 真机 `slow_callback` 只落一条 |
| 新增依赖限于官方语法包并记录许可与体积 | `package.json` 8 个 `@lezer/*` | `deps/npm-view.txt`（全 MIT）+ `deps/sizes.txt` + design §1.4 复测行 |

**未验证项（不许当已验）**：真机侧的「声明起点 vs 标题行尾」字符级差异（AX 不暴露选区；由 chromium
侧读 CM 选区断言）；release 构建下的常驻内存门禁级读数（本次是 debug + 单点采样，**不宣称达标**）；
Alex 的手感项（浮层在长条目下的观感、1MB 文件首次 ⌘⇧O 的可感程度）。

**归档待办（reviewer r1 的归档建议，本次不改 spec）**：delta 里
`specs/editor-live-preview/spec.md` 的 Scenario「解析结果缓存复用」写的是「切换文件后再切回，缓存按
**换文件即失效**的规则重建」，而实现（与 design §1.6 的先例）把**文档内容**当缓存键——切回同一份内容
会命中旧键、不重建（语义等价且更省：缓存的身份是内容，只有内容变了才重新解析，同时避免了「切回即
重算」）。**归档评审（Alex 节点）时把该 scenario 的措辞改准为「缓存键 = 文档内容」**，或按字面加主动
失效——两条都改，实现侧已按前者落地（`src/code-structure.ts` 的 `cacheKey` 与 2.1 的计数断言）。
