# Tasks: fix-json-key-highlight

## 1. 根因修复

- [x] 1.1 `src/preview/code.ts`：导出 json 的 tokenTable（`property → propertyName`）并挂到 json 的 `StreamLanguage.define`（`{ ...json, tokenTable }`；spread 后逐 token 复验 parser 仍工作——token/startState 与原型同源，见 4.4 的对照实验）。
- [x] 1.2 `src/editor.ts`：json 语言实例改用 `JSON_TOKEN_TABLE`（从 `preview/code.ts` import，两处同源），code 模式与围栏代码块的键色因此不可能各自漂移。
- [x] 1.3 `src/preview/code.ts`：token 名解析按 CM6 的 `createTokenType` 次序查 parser 的 tokenTable（defaultTable → tokenTable → tags）；解析缓存键改为「语言 + token 名」。
- [x] 1.4 规则条目序复核：propertyName 规则留在 string 之后（CM6 的 HighlightStyle 按条目序写 CSS，同节点多 tag 时靠后者命中），两处 HighlightStyle 均加注释说明；键色沿用既有 `--callout-note`，不新增颜色 token。

## 2. 测试与基线

- [x] 2.1 `tests/visual/scenes/m120-code-highlight.spec.ts`：json 断言改为键=属性色 / 字符串值=字符串色 / 数字与 bool/null=字面量色，输入维度扫一遍（顶层、嵌套、数组内对象、纯数字键、非 ASCII 键）。
- [x] 2.2 `tests/visual/scenes/render-codeblock.spec.ts`：「键取字符串色」旧断言与注释反转为新口径（注明这是 M147 前旧行为的反转）；新增 json 键着色**不变量**测试（生成器扫 7 组键/值形态，含 javascript 字符串键不跟着变）。
- [x] 2.3 全仓确认没有其它场景钉住旧的 JSON 键色：`rg -ni 'json|cm-lp-tok-property|propertyName' tests/visual/scenes tests/visual/fixtures` 逐条核对，只有 m120 与 render-codeblock 引用 json 键色，json 围栏只出现在 `fixtures/render-codeblock/languages.md`。
- [x] 2.4 视觉基线核定：**既有整页基线零变更**——`LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 全量 217 场景无 `--update` 通过，`render-codeblock-chromium-darwin.png` 的 sha256 在改动前后一致（`5bcaf5de…`）。原因已核实：该场景的整页截图是 1200×800 视口（`playwright.config.ts` 未开 fullPage），json 行落在折叠线以下，键色从未进过任何整页基线。
- [x] 2.5 补一张元素级基线 `render-codeblock-json-line.png`（同 m133 overlay 的元素截图口径），把键/值分色真正钉在视觉层；生成前后逐图过目（前：键=字符串绿；后：键=属性蓝、值=字符串绿、`3`=字面量橙）。
- [x] 2.6 `tests/visual/README.md`：补「删除 / 移动 UI 元素后的核对（卫生步骤，强制）」节，与 AGENTS.md 硬规则对齐（闭合 finding `20260917-worker-reviewmd-bug-ui-readme`）。

## 3. 制品

- [x] 3.1 `openspec/changes/fix-json-key-highlight/`：proposal + tasks + `specs/editor-live-preview/spec.md` 增量（JSON 键 SHALL 以属性名配色、与值区分）。
- [x] 3.2 `openspec/specs/editor-live-preview/spec.md` 对账：现有条款无「json 键同字符串色」的旧口径（全文 54 行逐条读过），无需修订——living spec 只在归档时并入本次增量。
- [x] 3.3 不改码审计：其余 legacy modes 的复合 token / 丢 tag 面排查（本仓语料按扩展名拼接后逐语言过 parser 并捕获 CM6 警告），结果投 TowerFinding 两份：`20260917-worker-jsonhl-bug-tag-token-rust-code`（rust 字符字面量在围栏里整条丢色、与 code 模式不一致）、`20260917-worker-jsonhl-improve-javascript-typescript-property-token-console-json-js-ts`（js/ts 的 `property` 复合 token 残留）。

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（17 passed / 0 failed）。
- [x] 4.2 `pnpm exec tsc --noEmit` 与 `tests/visual` 的 tsc（`../../node_modules/.bin/tsc --noEmit`）通过。
- [x] 4.3 视觉回归全绿：`LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 217/217；`cargo fmt --check` 与 `git diff --exit-code -- src/bindings/`（bindings 漂移）通过。
- [x] 4.4 node 直取 legacy parser + `highlightTree` 的对照实验：修前键只带 string 且打印 `Unknown highlighting tag property`，修后键带 string + propertyName，值与其它 token 不变；spread 出的 parser 的 `token`/`startState` 与原型同一函数引用。
- [ ] 4.5 `scripts/gate.sh quick` 的 cargo 两项（clippy / cargo test）**未跑**：磁盘可用仅 1.4 GiB，一次 debug 构建按本仓经验需 2–3G，按 [REVIEW.md](../../../REVIEW.md) 第 12 条的防线不发起（半截 target 不回血，会连带阻塞并行 worktree）。本 mission 改动面为纯 TS，未触碰 Rust 与 bindings；覆盖缺口已在 review-request 里如实声明。
