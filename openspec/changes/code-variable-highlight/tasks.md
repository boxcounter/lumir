# Tasks: code-variable-highlight

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是
「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。**本 change 当前是提案**：全部任务未勾选，
实现待 Alex 节点 1 裁决后另立 mission；实现顺序建议在 [code-outline](../code-outline/proposal.md) 之后
（本 change 只读消费它引入的结构解析与缓存）。

**条件项（裁决落在备选上时先改写 delta 与本节，再实现）**：

- 裁决点 1 取「只支持少数语言」→ 2.x / 3.x / 5.x 的逐语言断言按裁决收窄。
- 裁决点 2 取「严格作用域分析」→ 本 change 不可交付（无语言服务），须停手上报并按裁决改判为非目标；
  取「同名 + 同类、不做遮蔽判定」→ 3.3 与 4.4 的遮蔽断言删除，delta 的第 3 层判据改写，并把已知误亮面
  写进 spec 的边界段。
- 裁决点 3 取「不新增依赖」→ 本 change 退回「不做」。
- 裁决点 5 取「改字色 / 与搜索同形」→ 5.2 与 6.x 的样式断言按裁决改写（但「不新增颜色」这条硬约束
  不放松）。
- 裁决点 6 取「实现语法感知选词」→ 2.1 追加选词实现与其反向验证（并记录它与 CM 原生选词路径并存的口径）。

## 1. 现状读数与判据语料（实现前先测）

- [x] 1.1 复核现状读数：双击一个变量后没有任何额外高亮，唯一可见反馈是原生选区。
  **验收口径**：读数落 `test-results/<mission>/var-highlight-before/readings.json`（装饰数 = 0 + 选区范围 +
  计算样式读数）；与 [evidence/03](evidence/03-identifier-positions.md) §1 一致。
  **反向验证**：把「双击后出现 ≥1 个装饰」写成断言，实现前必须 FAIL。
- [x] 1.2 为每门支持语言（8 门）准备判据语料：同一语料里同时含局部变量、参数、顶层常量、字段 / 成员、
  类名 / 函数名、字符串与注释里的同名文本、以及遮蔽场景与跨函数同名的场景。
  **验收口径**：语料与期望命中集合落 `test-results/<mission>/var-highlight-cases.md`（每门语言一段），
  期望集合逐条给出**依据**（节点名 + 父链，格式同 evidence/03 §2）。

## 2. 触发判据

- [x] 2.1 实现触发判据：选区非空 / 单区间 / 完整包含于「变量类位置」最内层标识符节点内。
  **验收口径**：四条断言——① 完整选中命中；② 部分选中（`$price` 只选 `price`）命中；③ 跨节点选区不命中；
  ④ 落在字符串 / 注释里的选区不命中。②的判据是「包含于」而不是「等于」，把判据临时改成相等时②必须 FAIL。
- [x] 2.2 名字取**节点原文**，不取选区文本。
  **验收口径**：`$price` 场景断言点亮的是 `$price` 的出现、且 `price` 单独出现的位置**不**被点亮；
  把匹配文本改成选区文本时该断言 FAIL（反向验证留档）。
- [x] 2.3 轻触既有交互：MUST NOT 改选区、MUST NOT 抢焦点、MUST NOT 阻止默认行为。
  **验收口径**：双击后断言 `view.state.selection` 与不装本能力时逐字节相同（或与 CM 既有行为一致）；
  断言焦点仍在编辑器；无 `preventDefault` 路径（代码复查 + 场景断言各一份）。

## 3. 位置类别与变量类集合

- [x] 3.1 实现逐语言的位置类别判定（节点名 + 父链；依据 [evidence/03](evidence/03-identifier-positions.md) §2）。
  **验收口径**：8 门语言各一组「收录 / 排除」断言（每门至少 4 条：局部变量 ✓、参数 ✓、成员名 ✗、
  类 / 函数名 ✗）；把判定放宽到「所有标识符类节点」时排除类断言全部 FAIL（反向验证留档）。
- [x] 3.2 实现保守方向的 tie-break：判不出来按「可能是声明位」、源位置判不出来按「不是变量类」。
  **验收口径**：构造两个「语料里未覆盖 / 语法把该段解析成别的结构」的用例，断言落点在「少亮」这一侧；
  代码复查确认两处 tie-break 各只有一个入口（不是散落的分支）。
- [x] 3.3 明确排除面：属性 / 字段 / 成员名、函数与类名、类型名、对象键、导入名。
  **验收口径**：每条一个断言（同名字也要排除）；连同上一条一起落 `var-highlight-cases.md`。

## 4. 可见域（遮蔽判定）

- [x] 4.1 实现容器链与「源的绑定解析」（源是声明位 / 引用位 / 无可见声明三种）。
  **验收口径**：单测级断言三种源形态各自的 S（源容器）取值；无可见声明时 S = 根容器。
- [x] 4.2 实现方向合理性（第 3 条件）：同支才可能同绑定。
  **验收口径**：两个函数各一个同名局部变量的场景断言互不点亮；去掉该条件时断言 FAIL。
- [x] 4.3 实现隔断判定（第 4 条件）：更内层同名声明排除候选。
  **验收口径**：顶层 `LIMIT` + 函数内 `const LIMIT` 的场景断言函数内的出现不被点亮（而函数内两条互相
  点亮）；去掉该条件时断言 FAIL。
- [x] 4.4 逐语言复核「声明位」判据：确认语料里每个声明位都被认出来（未被误判成引用，否则遮蔽漏判 =
  错亮）。
  **验收口径**：为每门语言写一条「局部同名声明必须被认作声明位」的断言；漏判即 FAIL，不留「靠语料恰好
  没覆盖」的绿灯。

## 5. 索引、缓存与重算

- [x] 5.1 新增 `src/code-identifiers.ts`：从解析树构建名字 → 出现位置 / 位置类别 / 容器链的索引。
  **验收口径**：索引构建的耗时读数落 `test-results/<mission>/index-cost.json`（100KB 与 1MB 各一份）；
  断言索引条目数与语料里的标识符出现数一致。
- [x] 5.2 复用 code-outline 的结构解析与缓存（MUST NOT 另建一份）。
  **验收口径**：代码复查无第二份语言表 / 第二处 `parse(` 调用；断言「先按 `⌘⇧O` 再双击」与「先双击再按
  `⌘⇧O`」都只发生一次解析（计数为 1）。
- [x] 5.3 重算只发生在选区变化与文档装载；不在每次选区变化时重走整棵树。
  **验收口径**：断言第二次触发（同一文档、不同变量）不发生重新遍历（计数 / 耗时读数）；换文件后断言
  索引重建。
- [x] 5.4 性能与内存读数（真机 / 产品端点）：大文件（1MB）+ 高频标识符的装饰重建耗时、索引与树的常驻占用。
  **验收口径**：读数落 `test-results/<mission>/perf-var-highlight-*.json`；**不达标就写不达标**，并按
  design §8 备选②（只留派生数据、丢弃树）给出后续方案，不许悄悄加上限。

## 6. 呈现

- [x] 6.1 `Decoration.mark` + 类名 `cm-lp-code-binding` + 取既有 token，样式落
  `src/preview/theme.ts`。**取值裁决（2026-09-24 就地修正）**：取 `--bg-3` 而不是本行原写的推荐值
  `--bg-2`——code 模式的**当前行底色就是 `--bg-2`**（`src/editor.ts` 的 `.cm-activeLine`，code 分支装了
  `highlightActiveLine()`），因此 `--bg-2` 的底纹在用户刚双击的那一行上**完全隐形**、同一行上的第二处
  匹配也一起看不见（硬冲突，非审美问题）。`--bg-3` 是 `src/style.css:6` 的既有 token，满足「只取既有
  token + 不新增颜色 + 三层可区分」全部硬约束；tower 2026-09-24 裁决采纳，观感仍归 Alex 手感项
  （截图证据 `test-results/m198/`）。另：样式**另起一份** `codeBindingTheme` 而不是塞进
  `livePreviewTheme`——后者只装在 md 分支，塞进去在 code 模式下不落地（实现期实测读数
  `rgba(0, 0, 0, 0)`）。
  **验收口径**：断言装饰不改字符 / 不改行高（`scrollHeight` 触发前后逐像素相同）、`readDocument` 逐字节
  相同；`grep` 确认实现里没有新增色值字面量（只用 `var(--…)` 已有 token）。
- [x] 6.2 三层可区分：原生选区（`--sel`）、绑定匹配、搜索命中（`.cm-searchMatch`）计算样式互不相同。
  **验收口径**：先 `⌘F` 搜索同词再双击触发，读三者的 `getComputedStyle` 断言互不相同；把绑定匹配临时
  改成搜索匹配的表达式时断言 FAIL（反向验证留档）；断言未复用 `.cm-searchMatch` 类名。
- [x] 6.3 生命周期：清空选区 / 移到别处 / 切换标签 / 换文件 / 外部重载 → 装饰立即清除，无残留。
  **验收口径**：四条断言各一条；切文件后断言另一文件装饰数为 0（负向断言的配对正观测见
  [REVIEW.md](../../../REVIEW.md) 第 2 条）。
- [x] 6.4 无文案：不新增 toast / 提示 / aria 播报。
  **验收口径**：`git diff 文案-Copy.md` 为空；场景断言里没有新增 toast（T3 语言双击后 toast 数为 0）。

## 7. 视觉场景（chromium，CI 门禁）

- [x] 7.1 新增场景与 fixture（8 门语言各一份最小语料 + 一份遮蔽/跨函数语料）。
  **验收口径**：断言是「装饰覆盖的区间集合」这类可复算读数（不是「类名存在」），并对每条排除面各写一条
  负向断言；证据落 `test-results/<mission>/`。
- [x] 7.2 既有 `m120-code-highlight.spec.ts` 的 token 色断言逐条复核（本 change 不动着色）。
  **验收口径**：零改动通过；「预期零变更」这条要有逐条核对记录（fixture 名 + 结论），不许只看时间戳
  （[REVIEW.md](../../../REVIEW.md) 第 3 条）。
- [x] 7.3 基线核对：既有整页 / 元素级基线是否需要更新（预期零更新，因为不触发时不产生任何装饰），
  新增「高亮在场」的元素级基线。
  **验收口径**：先给逐张核对结论清单；新增基线的 `--update` 前截图须 Alex 过目（AGENTS.md 硬规则）。

## 8. 真机验收场景（WKWebView）

- [x] 8.1 **编号已顺延为 31**（`ls scripts/acceptance/scenarios/` 的现有最大是 30，30 是 code-outline）：
  新增 `scripts/acceptance/scenarios/31-code-variable-highlight.md`。
  **口径就地修正（2026-09-24，tower 裁决采纳；原因：本组的原字面要求在真机通道上不可判）**：
  ① **双击合成不出来**——`scripts/acceptance/README.md:311-322`（M184 实测 2026-09-19）四条通道全部造不出
  WKWebView 的 DOM `dblclick`；② **AX 不暴露装饰与颜色**（`design.md:89`，M197 的实机 AX dump 可复核）、
  runner **没有 DOM 探针**（断言词表只有 ax/editor/file/glob/shot）。因此本组的「真机判装饰在场/缺席」
  与「反向验证」在现有通道下**没有可判信号**。修正后的口径：触发通道改用 `⌥⇧F` 扩选 + `⌘F`（查询词取
  选区）**生成同一个触发判据所需的选区**（判据写在选区上、不写在手势上，触发的是同一段产品行为）；
  真机只判可判的三条（文档逐字节不变两条、T3/md 静默、截图留证）；装饰区间集合 / 三层可区分 / 反向验证
  全部落 chromium 层。**测量指针**：`test-results/m198/task8-ax-probe.md`（触发前后 AX dump 逐行比对，
  无可判信号）与 `test-results/m198/task8-real-machine-scope.md`（覆盖矩阵）。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过 + 真机 PASS，证据落
  `test-results/acceptance/<日期>/29-code-variable-highlight/`。**真机判据限制**：AX 不暴露装饰与颜色，
  因此真机只判「装饰节点的在场 / 缺席（可读 DOM 探针）+ 文档文本与磁盘逐字节不变」，颜色与形态归
  chromium 层；口径写进场景说明，MUST NOT 把「读不到」当「通过」。
- [x] 8.2 **真机反向验证不可做（2026-09-24 就地修正）**：本组原要求「把判定临时改成文档全词匹配 →
  字符串 / 注释用例必须 FAIL」，但那两条用例的判据是「装饰缺席」，而真机通道**读不到装饰**
  （8.1 的①②）——那种步骤只能得到恒真的断言（假绿，REVIEW.md 第 1、2 条）。反向验证因此**改为在
  chromium 层执行**（那里能直接读装饰区间与计算样式）：见 `test-results/m198/reverse-verification/`
  的 visual 组（含「全词匹配」变体必须让字符串 / 注释用例变红）。真机侧不做无法判定的步骤，
  口径写进场景正文。
- [x] 8.3 不改写源文件的真机判据：`editor.unchangedSince` + 磁盘文件 `unchangedSince` 两条断言在位且 PASS。
  （本组不受 8.1/8.2 修正影响——装饰不可读恰恰不影响「文档逐字节不变」这条判据的可判性。）
- [x] 8.4 手感项交 Alex：真机双击 → 高亮的可感延迟与底纹可辨识度只留截图与读数，不做审美断言（归 Alex）。
  修正后的场景里「双击」由 ⌥⇧F + ⌘F 的选区代替，截图仍给出同一处底纹的两个视角（面板开 / 关）。

## 9. 验证与收官

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；
  `bash scripts/docs-check.sh` PASS；日志落 `test-results/<mission>/gate-*.log`。
- [x] 9.3 `git diff --check` 通过；改动文件集合与 Impact 清单一致（`src-tauri/**` 预期零改动）。
- [x] 9.4 收官对账：tasks 全部勾选（或标注放弃原因）；spec 增量与实现逐条对账（三层判据、排除面、保守
  方向、三层可区分、生命周期）；design §7 的未验证项按实测改写。
- [x] 9.5 误亮率抽样读数：取 vault 里 N 个真实代码文件、人工核 M 次触发，记录误亮 / 漏亮形态。
  **验收口径**：读数落 `test-results/<mission>/false-positive-sample.md`；未做就如实写「未做」，不许用
  小语料结果代替。
- [x] 9.6 归档跟踪：在 `docs/backlog.md` 的「待 Alex 裁决」节落一条待归档记录。

## 10. 已声明的边界 / 不做

- [x] 10.1 MUST NOT 退回字符匹配：实现里没有以文档字符串 / 正则 / 选区文本为判据的匹配路径。
  **验收口径**：代码复查 + 反向验证（把判据换成全词匹配时字符串 / 注释断言必须 FAIL）。
- [x] 10.2 不做 IDE 能力：无跳转定义 / 引用面板 / 跨文件 / 重命名 / 类型推断。
  **验收口径**：实现只读当前文档；`git diff src/keys.ts` 与 `src-tauri/**` 为空（零新命令、零新键位）。
- [x] 10.3 不做 md 模式：装饰只装进 code 分支。
  **验收口径**：md 模式断言零装饰；`git diff` 里 md 分支的扩展束零改动。
- [x] 10.4 不加配置项（颜色、字段是否算变量、开关一律不做）。
  **验收口径**：`git diff src-tauri/src/config.rs` 为空；无新配置消费者。

## 收官对账表（M198，2026-09-24）

逐组对账：每条任务的判据 → 实现落点 → 可 `ls` 的证据。

| 任务组 | 判据 | 实现落点 | 证据（可复跑 / 可 ls） |
|---|---|---|---|
| 1 现状读数与语料 | 实现前必须 FAIL；逐语言期望命中集合 | —（读数） | `test-results/m198/var-highlight-before/readings.json`、`var-highlight-cases.md`（70 条用例逐条给依据）、`reverse-verification/visual-capability-not-installed.log` |
| 2 触发判据 | 包含于而非等于；名字取节点原文；轻触既有交互 | `bindingSource()` / `bindingHits()`；无 DOM 事件、无 dispatch | 单测「触发」四条 + `reverse-verification/unit-partial-is-not-contained.log`、`unit-name-from-selection-text.log`；视觉「轻触既有交互」用例；`task10-boundaries.md` 的 grep 读数 |
| 3 位置类别与排除面 | 8 门逐语言 收录 / 排除；两个 tie-break 各一个入口 | `src/code-identifiers.ts` 的判据表 + `isVariableClass` / `isShadowingDeclaration` | 判据语料 70 条（`var-highlight-cases.md`）+ `reverse-verification/unit-classify-everything.log` |
| 4 可见域 | 遮蔽 / 方向；逐语言「局部是声明位」 | 归属判定 `resolveOwners()`（design §3.3 的等价改写，见模块头注释） | 单测「遮蔽」「方向」+ ts / java 各一条声明位断言；`reverse-verification/unit-no-owner-check.log` |
| 5 索引与缓存 | 复用 M197 解析（一次解析）；按文档缓存 | `src/code-identifiers.ts` 的索引缓存；`src/code-structure.ts` 的 `structureTree` | 单测「共用解析」「索引按文档缓存」；`perf-var-highlight.json`（**1MB 首触发 ≈ 0.91s，不达标**，后续路径 design §8 备选②） |
| 6 呈现 | 只说底纹不改字色；三层可区分；生命周期清除；零文案 | `src/preview/theme.ts` 的 `codeBindingTheme`（`--bg-3`） | 视觉「三层可区分 / 装饰不改文档也不改几何 / 生命周期」三条；`reverse-verification/visual-binding-same-as-search-match.log`；`git diff 文案-Copy.md` 为空 |
| 7 视觉场景与基线 | 区间集合可复算；排除面负向；既有基线零更新 | `tests/visual/scenes/m198-code-variable-highlight.spec.ts` | `baseline-check.md`（33 张零改动 + 1 张待 Alex）、`visual-m198-run5.log`、`gate-visual.log` |
| 8 真机验收 | （口径已就地修正）可判三条 + 截图 | `scripts/acceptance/scenarios/31-code-variable-highlight.md` | `acceptance-31-run4.log`（**1/1 PASS**）、`task8-real-machine-scope.md`、`task8-ax-probe` 段（同文件第三节） |
| 9 门禁与收官 | gate / docs-check / openspec validate 全绿 | — | `gate-quick.log` / `gate-visual.log` / `docs-check.log` / `openspec-validate.log`；`false-positive-sample.md`；`docs/backlog.md` 第 22 条 |
| 10 边界 | 无字符匹配路径；无 IDE 能力；md 零装饰；零配置项 | — | `task10-boundaries.md`（逐条命令与读数）+ `reverse-verification/unit-document-word-match.log`、`unit-language-gate.log` |

**如实登记的偏离（3 条）**：
1. 呈现色值取 `--bg-3` 而非任务书写推荐的 `--bg-2`（理由：与 code 模式当前行底色重合会隐形；tower 2026-09-24 裁决采纳）；
2. 真机触发通道改用 `⌘F` + 查询词 + 回车生成选区（双击在真机通道合成不出、AX 不暴露装饰；tower 裁决采纳）；
3. `src/code-structure.ts` 新增一条只读入口 `structureTree`（提案原文写「只读消费」，但原接口只给派生条目、不给树；不另建语言表、不另起 parse 调用，解析次数仍为 1）。

**如实登记的不达标项**：1MB 级文件的首次触发耗时（headless 下界 0.91s，其中解析 0.28s、索引构建 0.64s）超过 design §1.6 的解析量级估计；已在 `perf-var-highlight.json` 落盘，后续路径按 design §8 备选②（只留派生数据、丢弃树）。
