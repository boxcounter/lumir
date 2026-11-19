# Tasks: add-list-input-contract-nov18

## 1. 合同与实现

- [x] 1.1 在 `docs/specs/lists.md` 写入 L6，覆盖普通 `insertText` / IME 提交、其他源码不变、精确选区、marker 数量与计算样式/body x 稳定、undo/redo、dirty/save，以及 DOM/AX 拼接不得作为吞输入依据。
- [x] 1.2 在 editor-live-preview delta 中加入对应跨层 requirement 与可判定 scenario；proposal 记录 Alex 对 tower 的节点 1 全权委托。
- [x] 1.3 删除 `src/editor.ts` 已证实无消费者的空 `keydown` 手柄及过时注释；保留裸 marker Enter/Backspace、原子导航与 marker 几何。

## 2. 回归与真机场景

- [x] 2.1 在 `tests/visual/scenes/lists.spec.ts` 增加连续空有序项的点击与模型选区两路回归，独立断言精确 doc/selection、每项恰一个 marker、样式/body x、保存载荷、undo/redo 与 dirty。
- [x] 2.2 用代表样本覆盖 bullet、嵌套、裸 marker 与组合提交文本，不做全类型笛卡尔积，不新增专用生产分支。
- [x] 2.3 更新真机场景 153，覆盖连续空项输入、精确落盘与撤销；widget 接管后只走不点击的注入通道。
- [x] 2.4 对关键断言做反向变异，确认 doc/selection、marker/几何、保存与历史判据具有区分度；恢复后目标测试全绿，不宣称存在修前失败。

## 3. 验证

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 3.2 相关前端单测、视觉 `tsc` 与目标 Chromium 列表测试通过。
- [x] 3.3 `scripts/gate.sh quick` 与 `scripts/gate.sh visual` 通过并记录 `GATE RESULT` 原文及退出码；不更新像素基线。
  - rebase 前（旧 tip `7ca250b0`）：`quick` `GATE RESULT: 12/13 PASS（SKIP 0）`，退出码 1；唯一红项为基线已有的 `fixed_segments_keep_migrated_bytes` 身份段指纹不一致，独立复跑同红，已登记 finding。`visual` `GATE RESULT: 13/15 PASS（SKIP 0）`，退出码 1；除同一 Rust 基线红项外，全量浏览器 953 PASS / 1 SKIP，另有一条 harness 思考块场景在全量中失败、单独复跑 PASS。
  - rebase 后最终 tip `ddb784c4` 串行全量复跑：`quick` `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（`gate-quick-rebased.log`）；`visual` `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0，visual-regression 627s（`gate-visual-rebased.log`）。上述日志在主仓 `.local/missions/add-list-input-contract-nov18/`。未更新像素基线。
- [x] 3.4 真机场景 153 按 tower 串行协调执行并记录 PASS 证据；未复现的原始输入法/原始文档边界如实保留。
  - 2026-11-19 早先正式执行退出码 2：安装版 `/Applications/Lumir.app`（pid 33429）触发 `assertNoForeignLumir`，验收 app 未启动；按 tower 指示不代退、不绕过，真机 PASS 留待统一真机窗口。日志见主仓 `.local/missions/add-list-input-contract-nov18/acceptance-153.log`。
  - 2026-11-19 统一真机窗口（合并提交 `edc5ed6c` 之后，11:35 +0800 起跑）：`status.txt` = `PASS`，`steps.md` 21 条 PASS（含 8 条截图证据），覆盖连续空项第 7 项输入、精确落盘与一次撤销恢复原文。证据主仓 `.local/acceptance/2026-11-19-editor-trust/153-ordered-list-auto-mode/`（`meta.json` startedAt `2026-11-19T03:35:30.625Z`）。
