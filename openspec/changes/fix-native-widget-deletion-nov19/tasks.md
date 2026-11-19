# Tasks: fix-native-widget-deletion-nov19

## 1. 合同与实现

- [x] 1.1 在 `docs/specs/lists.md` 写入 L7：跨 replace 装饰的跨行删除只改预期源 range、判据只读 EditorState、一次 undo / 精确保存、既有路径不动；附证伪方式（有向矩阵 + 反向验证 + 真机 261）。
- [x] 1.2 在 `openspec/changes/fix-native-widget-deletion-nov19/specs/editor-live-preview/spec.md` 加入对应 requirement 与可判定 scenario。
- [x] 1.3 在 `src/editor.ts` 实现 beforeinput 闸门 `absorbLineMergeDelete`：空光标在行边界时对 Delete / Backspace / `⌘⌫`（含词删除变体）preventDefault 并 dispatch 显式事务；判据不读 DOM / 不检测 widget；只在 md 模式装配。
- [x] 1.4 词删除变体改调应用自身命令（`deleteWordForward` / `deleteWordBackward`），避免按引擎原生词边界猜范围。

## 2. 回归矩阵与真机场景

- [x] 2.1 `tests/unit/editing-oracle-model.ts` 增加 `deleteLineBackward`（`⌘⌫` 两态：行中删到行首、行首删前一个换行）。
- [x] 2.2 `tests/visual/scenes/editing-oracle.spec.ts` 把 forward Delete 的 `test.fixme` 转正，移除 `deletesDashBulletNewline` 绕路与随机生成器的 forward marker 邻接护栏。
- [x] 2.3 新增有向矩阵：`-` / `+` / `*` / 有序 / 任务 / 嵌套 × wikilink / 行内公式 / 隐藏标记（`**`）× Delete / Backspace / `⌘⌫`，另含普通行与 lazy continuation 对照；每格先断言被吸收行确实渲染 replace 装饰，再与独立模型对拍 doc/选区并验一次 undo。
- [x] 2.4 新增 `⌘S` 精确落盘用例（盘上全文 = 源文档的精确合并）。
- [x] 2.5 新增 `scripts/acceptance/scenarios/261-native-widget-deletion.md`（列表 / wikilink / 公式 + 精确落盘 + 撤销），用 `node scripts/acceptance/coverage.mjs` 更新 COVERAGE。
- [x] 2.6 真机 261 执行并记录 PASS 证据；M836 期间真机窗口已结束，未跑不得记 PASS。
  - M839 先修 261 场景的两条 oracle 缺陷（`a84a66ae`，只改场景 md，不改产品代码），随后真机重跑：261 `PASS`、33 断言 / 0 失败、48.5s、exit 0，witness C 的 `file.exact alpha$x$` 逐字节命中（`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-widget-oracle-fix/` 的 `summary.md` / `results.json` / `run.log`）。

## 3. 验证

- [x] 3.1 `pnpm test`（含模型随机 seed 脚本）全绿：1507 pass / 0 fail。
- [x] 3.2 目标 Chromium 场景全绿：`editing-oracle.spec.ts` 38 passed。
- [x] 3.3 目标 WebKit（真机同款 UA）场景全绿：37 passed / 1 skipped（composer IME 仅 Chromium）。
- [x] 3.4 随机 seed 2 / 13 / 29 在移除绕路后全绿（Chromium，见 3.2 的用例清单）。
- [x] 3.5 OpenSpec validate、docs-check 与完整 `scripts/gate.sh quick` / `visual` 通过并记录 `GATE RESULT` 原文；不更新像素基线。
  - 最终口径：`git rebase --onto master 89e7959b` 只重放本 mission 两个提交（快照提交含 prompts / src-tauri WIP，随 rebase 移除），tip 基座 master `79e8815`。
  - 新 tip（`fa57af5e` 前的实现提交）跑 `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。
  - 同 tip 串行跑 `LUMIR_VISUAL_PORT=4386 scripts/gate.sh visual`：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（`visual-regression` 780s，含全量像素；未更新任何基线）。
  - 早先基于快照 tip 的 `fixed_segments_keep_migrated_bytes` 红随快照移除消失——坐实它来自快照自带的 identity prompt（2173 vs 2181 字节），与本 mission 无关；同现场已由 M830 的 finding 登记。
- [x] 3.6 反向验证：临时摘除闸门后矩阵中列表 / wikilink / 公式 / `**` 格变红（6/6 失败，doc 长度与字形均被改写；恢复后全绿）。
