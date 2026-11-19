# Tasks: move-composer-to-codemirror-nov18

## 1. 合同与纯状态

- [x] 1.1 建立提案 / 设计 / spec 增量，重写 `docs/specs/harness-composer.md`，明示附件前置、保留行为与取消的交错 / 卡片 caret / 跨卡选区。
- [x] 1.2 实现最小 CM6 state、附件 `StateField` / 可逆 effect、附件前置投递和文本命令适配；不引入 Markdown parser / 新依赖 / 第二 history。
- [x] 1.3 实现草稿 v2 round-trip 与 v1 一次性转换，覆盖文本、未知块、卡片顺序和 caret 映射。

## 2. 面板接线

- [x] 2.1 用 CM host + 区外 tray 替换 contenteditable；删除 DOM↔block caret、normalize、自管 snapshot undo 与块级 selection highlight。
- [x] 2.2 保留普通输入、IME 确认门、Enter 发送、⇧Enter、Emacs / kill-yank、撤销、纯文本 / 图片粘贴和 ⌘A 文本全选。
- [x] 2.3 保留三类卡片跳回 / 移除 / focus、图片编号与 `@`、失败态、发送恢复、per-vault 草稿；插入附件不拆文本、不动 caret。
- [x] 2.4 保持既有视觉几何、主题和滚动档，不更新视觉基线。

## 3. 测试与验收制品

- [x] 3.1 重写旧块模型单测，覆盖附件共享 history、文本 Backspace / ⌘A / IME 不改附件、投递 golden、草稿迁移和失败恢复。
- [x] 3.2 重写真实浏览器场景；Chromium CDP 原生组合覆盖 Backspace 不吃 committed 文本、取消 / 提交 / Enter，WebKit 合成边界如实标注。
- [x] 3.3 回扫并改写权限内验收场景与 `COVERAGE.md`，退役卡间 caret / 跨卡选区 / 整卡删除断言，保留历史交错显示与 WKWebView 人工 IME 步骤。
- [x] 3.4 测最小 CM 实例 keypress-to-paint 与常驻内存，保存可复跑证据，对照项目 `<16ms` / `<200MB` 合同。

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 4.2 相关单测、`pnpm test`、`pnpm exec tsc --noEmit` 与 `scripts/gate.sh quick` 通过，照抄 `GATE RESULT`。
  - 最终 tip `7344736d`（= 合并提交 `8814bbf0` 第二父）：`scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（`.local/missions/move-composer-to-codemirror-nov18/gate-quick.log` 首行为完整 tip）；`pnpm test` 1495 pass / 0 fail（同目录 `unit.log`）；`pnpm exec tsc --noEmit` 在同 tip 的 `visual` 档 `tsc-root` 与 `tsc-visual` / `tsc-unit` 三门均 PASS。
- [x] 4.3 本地 `scripts/gate.sh visual` 通过且不更新基线，照抄 `GATE RESULT`。
  - 同 tip：`scripts/gate.sh visual` → `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；`visual-regression` 624s、946 passed / 1 skipped / 0 failed，未更新任何基线（`.local/missions/move-composer-to-codemirror-nov18/gate-visual.log`）。
- [x] 4.4 静态验收检查通过；真机由 tower 串行安排，原生 WKWebView IME 证据缺口如实报告。
