# Proposal: JSON 键名着色修复——键与值分色

- Change ID: fix-json-key-highlight
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 人工测试发现「JSON 格式的语法着色效果不好——全是一种颜色，和没着色没有区别」（截图：`base.json` 的对象键与字符串值同为绿色，只有 `true` 是橙色）。

根因是三条叠加，每条都有源码锚点：

1. legacy json mode 把对象键标成**复合** token `string property`——`@codemirror/legacy-modes/mode/javascript.js:518` 的 objprop 分支 `cx.marked = jsonldMode ? "property" : (cx.style + " property")`。
2. CM6 的 `createTokenType` 逐词解析复合 token，而 `property` 不在 `@lezer/highlight` 的 tags 里（只有 `propertyName`）→ 该词被丢弃并打 `Unknown highlighting tag property` 警告；`defaultTable` 里的 `property → propertyName` 兜底只按**完整** token 名命中，复合名查不到（`@codemirror/language` 的 `TokenTable.resolve` / `createTokenType`）。
3. 净效果：键只剩 `string` tag、与字符串值同色，`src/editor.ts` 的 propertyName 配色规则（`--callout-note`）永远匹配不到 json 键——「全是绿色」。

复现（本仓实测，node 直取 legacy parser + `highlightTree`）：修前键 token 只带 string 类，同时打出 `Unknown highlighting tag property`；修后键 token 同时带 string 与 propertyName。用户可见的判据是计算色：键 `--callout-note`、字符串值 `--callout-tip`、数字/布尔/null `--callout-warning`。

## What Changes

1. **补 json 的 tokenTable**：json 的 `StreamLanguage` 显式声明 `property → propertyName`，复合 token `string property` 因此解析为 `[string, propertyName]`；警告消失。code 模式（`.json` 文件）与 md 围栏 ```json 代码块两条渲染路径共用**同一份** token 映射——表由 `src/preview/code.ts` 单一持有，`src/editor.ts` 从那里 import。
2. **键的配色由规则条目序裁决**：CM6 的 HighlightStyle 按条目序写 CSS，同一节点带多个 tag 时**靠后**的条目命中；propertyName 规则保持在 string 之后，键落属性名色 `--callout-note`，与字符串值 `--callout-tip` 区分。不新增颜色 token。
3. **围栏路径的 token 名解析读 parser 的 tokenTable**：`src/preview/code.ts` 的 tag 解析按 CM6 的 `createTokenType` 次序查（defaultTable → parser 的 tokenTable → `@lezer/highlight` 的 tags），因此两侧对同一段 json 得到同一组 tag；解析缓存键加上语言名（同一 token 名在不同语言下可以落到不同 tag）。
4. **不变量与回归**：json 键色断言从单一 fixture 改为**输入维度扫描**——顶层/嵌套/数组内对象、空对象与空数组、单行紧凑、纯数字键、非 ASCII 键、含点/冒号/空格/转义引号的键；code 模式侧断言 DOM 计算色，围栏侧断言 token 类。另补一张**元素级基线**（`render-codeblock-json-line.png`）：该场景整页截图是 1200×800 视口、json 行在折叠线以下（本次逐张核对基线后确认键色从未进过任何整页基线），整页对比守不住键色；元素截图口径与 m133 的 overlay 一致。
5. **javascript/typescript 不跟着改**：同一条 objprop 分支在那里产出同样的复合 token，但对象字面量的字符串键本来就该是字符串色；测试里钉住「不跟着变」。

## Non-goals

- 不引入新依赖（不加 `@codemirror/lang-json`）：tokenTable 映射是同一目标下更小的修复。
- 不改 javascript/typescript 及其它 legacy mode 的复合 token 丢 tag 面——本 change 只修 json，避免视觉基线大面积漂移；排查结果另投 finding，不夹带进本次实现。
- 不改 `src/preview/theme.ts` 的色值与既有 editorial token（键色沿用既有的 `--callout-note`），不改 `src/preview/code.ts` 以外的 preview 文件。
- 不改 json parser 的 token 边界与切分行为，只补 token 名的 tag 解析；装饰不改写文档，`EditorState.doc` 与磁盘文件逐字节不变。

## Impact

- 影响的 specs：`editor-live-preview`
- 影响的代码/系统：`src/preview/code.ts`（token 映射单一来源、token 名解析读 parser 的 tokenTable、解析缓存键含语言）、`src/editor.ts`（json 语言实例带 tokenTable）
- 影响的测试/验收：`tests/visual/scenes/m120-code-highlight.spec.ts`、`tests/visual/scenes/render-codeblock.spec.ts`（新增元素级基线 `baselines/render-codeblock.spec.ts-snapshots/render-codeblock-json-line.png`）、`tests/visual/README.md`（基线的删/移 UI 核对卫生节，顺带闭合 finding `20260917-worker-reviewmd-bug-ui-readme`）
- 关联约束：ADR 0002 §2（单内核双模式）、ADR 0003 §3（装饰不改写文档）、[REVIEW.md](../../../../REVIEW.md) 第 8 条（同一语义两处真源）、第 3 条（容差假绿）
- 视觉基线：**既有整页基线零变更**（全量 217 场景无 `--update` 通过，`render-codeblock.png` 的 sha256 改动前后一致）——json 行在该场景的视口截图里位于折叠线以下，键色从未出现在任何整页基线里；新增一张元素级基线把键/值分色钉住。`m120-code-highlight` 无截图断言，只有计算色断言。
