# Tasks: unify-grapheme-backspace-nov19

## 1. 探针与合同

- [x] 1.1 读 REVIEW.md、M843 的两条 finding（composer ⌃H 与物理 Backspace）与 M854 / M859 的既有闸门合同；修复前在 Node 层复现 composer ⌃H 的部分删除（5 类簇：肤色 / 职业 ZWJ / 组合重音 / 阿拉伯文附标 / 希伯来文附标），读数记入 mission 报告。
- [x] 1.2 定义合同：折叠 caret 上的无修饰物理 Backspace（`deleteContentBackward`）在 md / code 正文与 composer 都按 `quote-card.clusterBackward` 删一个整字素簇，一个事务 = 一条 history 步；IME / 只读 / 修饰键变体 / 非空选区保持既有路径。规格 delta 落 `editor-live-preview`（MODIFIED 被证伪句 + ADDED 新 requirement）与 `harness`（composer 文本导航族）。

## 2. 实现

- [x] 2.1 `src/harness-composer.ts`：`editor.delete-char-backward` 的折叠 caret 分支改走 `clusterBackward`（复用本文件 `deleteRange`），移除 CM `deleteCharBackward` 的依赖；forward delete 与词删除不动。
- [x] 2.2 `src/harness-composer.ts`：新增 `absorbComposerGraphemeBackspace`（导出供 Node 层判据）并作为 `EditorView.domEventHandlers({ beforeinput })` 装进 `composerStateExtensions`。
- [x] 2.3 `src/editor.ts`：新增 `absorbGraphemeBackspace`（同一份 inputType / 组合期 / 只读 / 选区判据），接到 `absorbNativeEdit` 的既有分支之后；code 模式新增 `codeGraphemeBackspaceGate`（只装这一条，不搬 M836 / M854 的选区与回读语义）。
- [x] 2.4 同步 `src/editor.ts` 的闸门注释块：删掉「空光标的普通行内删除仍走原生」的旧口径，写明 M860 的接管面与修饰键 / IME / 选区边界。

## 3. 回归与真机

- [x] 3.1 `tests/unit/text-unicode-adversarial.test.ts`：删除 `COMPOSER_BACKWARD_REMAINING` 表，composer ⌃H 改为统一整簇 + 单步撤销；新增普通 ASCII 类、跨面一致性用例，以及 composer 物理 Backspace 闸门矩阵（折叠 caret 接管；非空选区 / 词与行删除变体 / IME / 只读不接管）。
- [x] 3.2 `tests/visual/scenes/text-clipboard-adversarial.spec.ts`：删除按引擎分档的 `NATIVE_FIRST_STEP` 与 composer 残留表，正文 + composer 一次整簇 + 单步撤销；新增 code 模式与 composer `⌥⌫` 词删除两条双引擎用例；`tests/visual/README.md` 的判据面、基线段与已知边界同步。
- [x] 3.3 新增 `scripts/acceptance/scenarios/268-grapheme-backspace.md`（md 正文物理 Backspace、composer 物理 Backspace、composer ⌃H 三条 witness），`node scripts/acceptance/coverage.mjs` 重新生成 COVERAGE。
- [ ] 3.4 真机 268 在 tower 串行窗口内执行：先修复前构建判红、再修复后构建判绿（WKWebView 的物理 Backspace 与 ⌃H），读数与证据路径回填本节。

## 4. 验证

- [ ] 4.1 Node 层：`node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/text-unicode-adversarial.test.ts` 全绿（含新增闸门矩阵），完整 `node tests/unit/run.mjs` 全绿。
- [ ] 4.2 目标双引擎：`LUMIR_VISUAL_PORT=4402 pnpm --dir tests/visual exec playwright test scenes/text-clipboard-adversarial.spec.ts --project=chromium --project=webkit-realua` 全绿，读数回填。
- [ ] 4.3 `scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=4402 scripts/gate.sh visual` 全绿（照抄 `GATE RESULT` 原文行与退出码），不更新任何视觉基线。
- [ ] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh`、`node scripts/acceptance/run.mjs --check` 通过。
