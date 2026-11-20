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
- [x] 3.4 真机 268（2026-11-20，显示器/桌面恢复后执行）：**1/1 PASS，退出码 0**，场景 **13 条断言全过**（r7 25.0s / r8 17.9s 连续两跑）；修复后现场逐条命中：正文物理 Backspace `xمَy → xy`、composer 物理 Backspace `Qمَ → Q`、composer ⌃H `Q👩🏽‍🚀W → QW`，三处一次 undo 均精确复原。证据 `.local/acceptance/2026-11-20/268-grapheme-backspace/`，日志 `.local/missions/M860/acceptance-268-r7.log` / `-r8.log`（git 外）。
  - r4/r5 首两跑在 W2「⌘Z 复原」判红：Node 探针坐实是 CM history 的 `newGroupDelay`（500ms）把「粘贴 + 紧接的删除」并成一条 undo（间隔 0ms 合、600ms 分），不是产品回归；修复是把三个粘贴步改成 `do: keys`（`do: key` 的 `gapMs` 不生效）并等 700ms 越过分组边界（r6 仍红因为 `do: key` 的 gapMs 未生效，r7 起 PASS）。
  - 修复前红证据沿用既有记录：M843 finding 的双引擎实测 + 视觉层退回 master 的 mutant（3 条新用例全红，`.local/missions/M860/mutant-prefix.log`）；按 tower 裁决本窗口未重建修复前版本。

## 4. 验证

- [x] 4.1 Node 层（r1 修复后）：`node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/text-unicode-adversarial.test.ts` 60 tests 全绿；完整 `node tests/unit/run.mjs`：tests 1663 / pass 1661 / fail 0 / todo 2（两条 `⚠ 已知缺陷`），退出码 0。
- [x] 4.2 目标双引擎（`LUMIR_VISUAL_PORT=4402`，r1 修复后）：`59 passed (2.4m)`、1 skipped、退出码 0——chromium 30 条 + webkit-realua 29 条（IME 用例按既有纪律在 WebKit 项目 skip）。日志 `.local/missions/M860/target-spec-r1.log`（git 外）。
- [x] 4.3 quick / visual（r1 修复后，`LUMIR_VISUAL_PORT=4402 CARGO_TARGET_DIR=/tmp/lumir-m860-target`）：`scripts/gate.sh visual` 覆盖 quick + 视觉两层，读数 `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；`visual-regression` 1078s，全量 **1272 passed / 4 skipped**，**未更新任何视觉基线**（日志 `.local/missions/M860/gate-visual-r1.log`）。首次尝试被工具自身 45 分钟上限掐断，4 条失败均为浏览器被关的级联（`page.addInitScript: Target page, context or browser has been closed`），不是产品判红；本读数为无超时重跑。此前的 quick 独立读数 `GATE RESULT: 13/13 PASS（SKIP 0）`（日志 `.local/missions/M860/gate-quick-rebased.log`）在代码未变的 tip 上仍然成立。
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（gate 的 `openspec-validate` PASS；中间一次失败是 MODIFIED 段漏抄既有 scenario 标题，修正后转绿）、`bash scripts/docs-check.sh` PASS、`node scripts/acceptance/run.mjs --check`（245 场景）与 `coverage.mjs --check` 通过。
- [x] 4.5 review r1 P2-1 修复：`src/harness-composer.ts` 的本地 `deleteCharBackward` 入口恢复 `view.state.readOnly` 早退（旧 CM 命令在 `deleteBy` 里的只读保护），直接调用 `runComposerCommand` 的路径不再能删只读 composer 的簇 / 选区；新增只读回归（折叠 caret + 非空选区 doc/selection 不变），mutant 验证去掉守卫时该用例转红。Node 目标 60 tests、完整套件 1663 tests / fail 0；目标双引擎 59 passed / 1 skipped；quick+visual `15/15 PASS（SKIP 0）`。
