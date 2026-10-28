# Tasks: fix-bare-list-marker-backspace-oct28

## 1. 命令分派

- [x] 1.1 实现裸 marker 行 Backspace 单事务删除，限定空光标内容起点并保留前缀。
- [x] 1.2 接入高优先级内核 keymap，未命中继续走上游 / 原生路径；更新相关行为说明。
- [x] 1.3 用 ADDED requirement 固化第一次 Backspace 即删除的口径。

## 2. 回归覆盖

- [x] 2.1 单测覆盖空项、带内容项、引用 / 缩进、单事务与放行面。
- [x] 2.2 headless Chromium 覆盖第一次 Backspace、真列表对照与撤销。
- [x] 2.3 真机场景 153 增加 Backspace 用例并同步覆盖表。

## 3. 验证与归档

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（37/37）。
- [x] 3.2 `scripts/gate.sh visual` 通过（`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0），相关单测与 acceptance 静态检查通过。
- [x] 3.3 真机场景 153 / 158 PASS（2/2，exit 0），证据落 `.local/acceptance/2026-10-28/`。
- [x] 3.4 独立 reviewer clean/merge 后按五要件归档，并完成归档后审计（归档提交 `2c321117`，`--archived` PASS）。
