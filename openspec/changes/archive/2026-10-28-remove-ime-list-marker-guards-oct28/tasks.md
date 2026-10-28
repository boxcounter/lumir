# Tasks: remove-ime-list-marker-guards-oct28

## 1. 移除护栏

- [x] 1.1 删除 beforeinput 原生列表命令拦截、DOM 重复 marker 读回拦截及编辑器装配。
- [x] 1.2 删除只服务护栏的 marker token helper，保留裸 marker 行与正常列表续行实现。
- [x] 1.3 用 REMOVED requirement 记录「IME 组合期不重复插入列表 marker」整条废止。

## 2. 测试与验收回扫

- [x] 2.1 删除护栏专属单测 / 视觉断言，保留并清理正常列表续行与裸 marker 行测试。
- [x] 2.2 更新验收场景 153 / 158 与覆盖表，清除 WebKit 误归因，保留正常行为判据。
- [x] 2.3 全仓检索删除符号与旧根因描述，确认现行制品无残留、历史归档不改写。

## 3. 验证与归档

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（36/36）。
- [x] 3.2 `scripts/gate.sh visual` 通过（`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0），相关单测与 acceptance 静态检查通过。
- [x] 3.3 真机场景 153 / 158 PASS（2/2，exit 0），证据落 `.local/acceptance/2026-10-28/`（Alex 2026-10-28 后续已开放机器窗口，与 Backspace 修复同批复跑）。
- [x] 3.4 独立 reviewer clean/merge 后按五要件归档，并完成归档后审计（归档提交 `82df3660`，`--archived` PASS）。
