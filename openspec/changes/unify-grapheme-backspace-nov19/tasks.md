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
- [ ] 3.4 真机 268 在 tower 串行窗口内执行：先修复前构建判红、再修复后构建判绿（WKWebView 的物理 Backspace 与 ⌃H），读数与证据路径回填本节。反例判别性已在视觉层先行证实：把 `src/editor.ts` / `src/harness-composer.ts` 退回 master 后重跑新用例，3 条全红（`组合重音: code 模式整簇` / `肤色修饰: ⌃H 第一拍必须是整簇` 等），日志 `.local/missions/M860/mutant-prefix.log`（git 外）。**2026-11-20 真机窗口内三次尝试均判 INVALID（非产品判红）**：启动后 AX 读不到主窗（`windows 目录（2 扇）里没有 AXStandardWindow 主窗`），KimiCU 同实例报 `ax_window_missing_remote_rendered`；逐层探针确认本机当前会话**没有真实桌面合成**——`system_profiler` 报 Color LCD Online，但 `screencapture` 在唤醒前后都只得到 RGB 测试色条（像素直方图四类色块各约 2500 px / 128×83，无任何窗口内容），app 的真实 window_id 在 `list_windows` 可见、AX 却读不到其内容。日志 `.local/missions/M860/acceptance-268.log` / `-r2.log` / `-r3.log`；finding `20261120-worker-grapheme-backspace-bug-kimicu-ax-invalid` 与更正归因的 `20261120-worker-grapheme-backspace-bug-rgb-ax-268`。268 的修复后读数待真实交互桌面复跑，NOT_RUN 不得记 PASS。

## 4. 验证

- [x] 4.1 Node 层：`node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/text-unicode-adversarial.test.ts` 59 tests 全绿；完整 `node tests/unit/run.mjs`：tests 1662 / pass 1660 / fail 0 / todo 2（两条 `⚠ 已知缺陷`），退出码 0。
- [x] 4.2 目标双引擎（`LUMIR_VISUAL_PORT=4402`）：`59 passed (2.4m)`、1 skipped、退出码 0——chromium 30 条 + webkit-realua 29 条（IME 用例按既有纪律在 WebKit 项目 skip）。日志 `.local/missions/M860/target-spec.log`（git 外）。
- [x] 4.3 quick：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（日志 `.local/missions/M860/gate-quick-rebased.log`）。visual（`LUMIR_VISUAL_PORT=4402 CARGO_TARGET_DIR=/tmp/lumir-m860-target`）：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；`visual-regression` 1070s，全量 **1272 passed / 4 skipped**，**未更新任何视觉基线**（日志 `.local/missions/M860/gate-visual.log`）。
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（gate 的 `openspec-validate` PASS；中间一次失败是 MODIFIED 段漏抄既有 scenario 标题，修正后转绿）、`bash scripts/docs-check.sh` PASS、`node scripts/acceptance/run.mjs --check`（245 场景）与 `coverage.mjs --check` 通过。
