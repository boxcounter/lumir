# Proposal: toml/yaml 代码块的键着色修复与着色门禁补齐

- Change ID: codeblock-toml-yaml-highlight
- 日期: 2026-09-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **实现任务尚未开工**——本 change 当前只有提案四件（proposal / design / tasks / spec 增量），`tasks.md` 第 2 组起全部未勾选

## Why

Alex 实测原话（M167 mission Context 逐字）：「toml 和 yml 代码块没有高亮着色」。

在 master@2f16f86 上按 M138 的口径实测核实（chromium 真实渲染 + 真实模块，方法与逐条结果见 design.md §1）后，这句话拆成四条能站得住的事实：

1. **toml / yaml 早在收录表内，本 change 不存在「注册表补缺」这件事。** 两项语言在 `src/preview/code.ts:75-97` 的 `LANGUAGES`（`toml` `:87`、`yaml` `:88`），`yml → yaml` 别名在 `:121`，`.toml` / `.yaml` / `.yml` 三个扩展在 `src/preview/attachments.ts:54-56`——都是 M138（`ca81b7c`）落地的，M152（`6e8e70a`）只是把这张表收口为单一来源。「语言注册表补缺」的表述 MUST NOT 写进本 change 的交付面。
2. **yaml 的「看起来没高亮」用 Alex 自己 vault 里的实际块复现了。** 取 `/Users/boxcounter/Downloads/Everything-copy/4_Archives/Engineering/Logbook/README.md` 的第一个围栏块（```yaml，30 行，`dimensions:` 那张表）原样渲染：**14 个着色 span 里 13 个是键，全部落同一个类** `cm-lp-tok-literal`（`rgb(160, 94, 28)` 赭色，与数字、布尔同色），余下 1 个是注释；`property` / `string` / `keyword` 三类**零命中**。值（`Goal`、`monthly`、`Slax Reader`…）、`-`、`:` 一律正文色。**整块只出一种颜色**——这正是 M147 修 json 时 Alex 说的「全是一种颜色，和没着色没有区别」，只是换成了 yaml。截图 [`evidence/01-yaml-block-as-is.png`](evidence/01-yaml-block-as-is.png)（实现前现状），逐 span dump 与命令见 [`evidence/03-复核记录.md`](evidence/03-复核记录.md)。
3. **toml 这条报告未能复现。** vault 的 1525 份 `.md` 里围栏语料普查：`yaml` 8 个、**`toml` 0 个、`yml` 0 个**（design.md §1.3 的复跑命令）——即「toml / yml 代码块」在可触及的语料里没有对应现场。另用合成块实测 toml 围栏：节头 `[x]` / `[[x]]` 取字面量色、键取属性色、字符串取字符串色、数字与布尔与日期取字面量色、注释取注释色——五种 token、四种颜色，观感与同一文档里的 rust / json 块一致，截图 [`evidence/02-toml-block-as-is.png`](evidence/02-toml-block-as-is.png)。据此本 change **不改 toml**（只把它纳入门禁）。
4. **门禁不兜底，这是本类报告能到 Alex 眼前的原因。** `tests/visual/fixtures/render-codeblock/languages.md` 只含 rust / typescript / python / bash / json 五种语言的围栏，**无 toml、无 yaml**；`render-codeblock.spec.ts:57-59` 对 `yml` 的断言只有 `highlightCode(...).length > 0`（非空即过，无区分度，[REVIEW.md](../../../REVIEW.md) 第 1 条同族）。21 种收录语言里只有 5 种受断言保护。

根因（与 M147 同族，有源码锚点）：legacy yaml mode 把**映射键**标成 `atom`（`node_modules/@codemirror/legacy-modes/mode/yaml.js:77` 的 `return "atom"`——该文件里唯一一处），而 `atom` 落在既有配色表的**字面量**组（`src/preview/code.ts:152` 的 `tags.atom`）→ 键与数字、布尔同色；yaml 的普通标量值在 mode 里返回 `null`，本就不产出 token。json 的同类问题在 M147 用 **parser 级 tokenTable** 修好了（`src/preview/code.ts:64` 的 `JSON_TOKEN_TABLE`），yaml 没同步——「同一语义两处口径」的另一现场（[REVIEW.md](../../../REVIEW.md) 第 8 条）。

## What Changes

一份行为修复 + 一份门禁补齐，**不新增颜色、不改文档内容**：

1. **yaml 收录 parser 级 tokenTable：`atom → propertyName`**（机制与挂点沿用 M147 的 `JSON_TOKEN_TABLE`），让 yaml 的键取属性色（`--callout-note` 蓝），与 json / toml 的键同口径。挂点在**单一来源**处（`src/preview/code.ts` 的 `LANGUAGES`），围栏与只读 code 模式两条路径同时生效，parity 不可能漂移。
2. **toml 不改**：实测已正常（Why 第 3 条），本 change 只把它纳入门禁；toml 节头为什么不能照做同样的修复（`atom` 三处过载），见 design.md §4.1 与 Non-goals。
3. **视觉 fixture 与断言补齐**：fixture 增 toml / yaml / yml 三个围栏（含 Alex 真实块的形态：嵌套映射 + 序列值 + 行尾注释 + 非 ASCII 值；以及 `commitments` 那种平铺映射），场景加「逐 token 类型 → 类名 → 计算色」断言、围栏与 code 模式的 parity 对照，并新增一张元素级基线把 yaml 键色钉在视觉层（整页基线守不住折叠线以下的代码块，M147 已实证）。
4. **色值与铁律不动**：token 色 MUST 只取既有 editorial token（`src/preview/theme.ts:63-68`）；装饰层 MUST NOT 改写文档（ADR 0003 §3）。

## Non-goals

- **不改 toml 的节头着色**：toml mode 对节头 `[x]` / `[[x]]`、布尔、日期三处都返回 `atom`（`node_modules/@codemirror/legacy-modes/mode/toml.js` 的三处 `return "atom"`），在 token 名层面不可区分，parser 级 tokenTable 无法只改节头。要区分只能改 vendored parser 自身——等于 fork 依赖，明确不做。
- **不给 yaml 的其余 token 补色**（除非裁决点 2 选方案 B）：纯标量值（parser 返回 `null`）、文档分隔符 `---` / `...`（`def`）、锚点与别名 `&a` / `*a`（`variable`）、结构标点 `:` / `- ` / `[]{}`（`meta`）一律保持现状。前两类是 vendored parser 的 token 产出，后一类与全仓「标点不取色」的既有口径一致（rust 的 `{}` `;` 同样不取色）；给它们补色要新增配色角色，直接违反第 4 条不变量。
- **不动收录表本身**：不加新语言、不改既有别名、不改 `MAX_HIGHLIGHT_CHARS`（`src/preview/code.ts:252` 的 64 KiB 安全阀对 toml/yaml 同样适用，本 change 不例外也不改它）。
- **不做 fence info string 的额外归一化**：```` ```.toml ````、```` ```config.toml ````、```` ```toml; ```` 与首字符带零宽空格的形态当前静默降级为纯文本（design.md §2.2 逐个实测枚举），本次只记录不改——放宽别名面需要需求证据，而实测表明 fence 名本身不是本次现象的成因。
- **不改 `src/editor.ts`**：它从 `src/preview/code.ts` import `LANGUAGES`，改一处两侧同时生效。

## Impact

- 影响的 specs：`editor-live-preview`（1 条 ADDED + 1 条 MODIFIED requirement）。ADDED = 「YAML 代码块的键名配色」；MODIFIED = 「Markdown 渲染保真（分隔线 / 围栏代码着色 / 引用内列表）」第 2 款——把 yaml 的键名口径接进该款，并把 toml 的 `atom` 复用（表头与布尔 / 日期同色）记进该款的「已知例外」段落，使「toml 不改」这件事在 living spec 里有落脚点（该 capability 当前无未归档 change 持有增量，无归档互覆风险）。**该款另含两条 M138/M152 既有行为的 spec 回填**（回填既有行为、不新增产品行为，本次一并申报，避免 delta 超出申报面）：①「该一致性 SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT 由两侧各自维护一份语言或配色表」+ Scenario「两侧语言与配色表同源」；②「着色 SHALL 受单一代码块长度上限约束（超过即回落纯文本，MUST NOT 因语言不同而放宽）」+ Scenario「着色受长度上限约束且与语言无关」
- 影响的代码/系统：`src/preview/code.ts`（新增 `YAML_TOKEN_TABLE` 并挂到 yaml 项——单一来源处，两侧消费同时生效）；`src/preview/theme.ts` / `src/editor.ts` 不改
- 影响的测试/验收：`tests/visual/fixtures/render-codeblock/languages.md`、`tests/visual/scenes/render-codeblock.spec.ts`、新增元素级基线、`scripts/acceptance/scenarios/render-markdown.md`（补一张截图证据，AX 树不承载颜色，真机侧不写颜色断言）
- 关联约束：ADR 0002 §2（单内核双模式）、ADR 0003 §3（装饰不改写文档）、[REVIEW.md](../../../REVIEW.md) 第 8 条（同一语义两处真源——本次仍只改单一来源处）、第 1 条（断言须有区分度）、第 3 条（容差吞变化）
- 视觉基线：**预计既有整页基线零变更**（yaml / toml 此前不在 fixture 内，其键色从未进过任何整页基线；本仓现有 yaml 基线为 0 张）；新增 1 张元素级基线，`--update` 前截图须 Alex 过目（AGENTS.md 硬规则）

## 裁决点（请在节点 1 一并裁决）

**裁决点 1 — Alex 手上的现场是哪一个？** 这决定本 change 是「修产品缺陷」还是「只留核销记录」：

- (a) 走 `pnpm tauri dev`（devUrl 1420 → 实时 src）：那看到的就是 Why 第 2 条的单色 yaml，本 change 照案实现。
- (b) 走打包 / 裸二进制（`custom-protocol`）：主仓 `dist/` 的时间戳是 **2026-09-16 15:42**，M138 合并于 **2026-09-16 20:53**，`dist/assets/*.js` 里 `cm-lp-tok-` 的命中数是 **0**——那样渲染的是**完全没有代码块着色**的前端（任何语言都没色），toml 出现在清单里也说得通。若为此情形，产品侧无缺陷，本 change 缩为「门禁补齐」或按撤回口径处置（见 tasks.md 5.2）。

**裁决点 2 — 修复广度：方案 A（建议）还是方案 B？**

- **方案 A（本提案的 What Changes）**：yaml 的键改取属性色。最小改动、不动配色角色表、parity 结构上不变、既有基线零变更。
- **方案 B**：连 yaml 的值与结构符号（`-`、`:`、`---`、锚点）一并上色。代价是新增配色角色（`TOKEN_GROUPS` + `src/editor.ts` 的 `CODE_COLORS` 两处穷尽检查同步）+ 全量视觉基线重建并逐张与 Alex 过目；**且新角色不是 yaml 独享**——该 token 名（`meta` / `punctuation`）在 21 门收录语言里有 **17 门**（10 个 mode 文件，按收录语言口径折算）会产出，加一个角色等于同时改掉这 17 门语言的观感（普查命令与逐语言读数见 [`evidence/03-复核记录.md`](evidence/03-复核记录.md) §6）；另外 yaml 的普通标量值在 vendored parser 里根本不产出 token，方案 B 也修不了它——只能让标点先有色。

未选的那一支在归档时标注放弃原因，不留悬空任务。
