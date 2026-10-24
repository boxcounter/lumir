# Tasks: quote-card-composer-focus-oct24

## 1. 产品侧：一处焦点移交

- [x] 1.1 `withModel` 返回重渲后落地的模型光标（`ComposerCaret | null`；IME 组合期冻结时返回
      `null`），供引用入口在焦点移交后重放 caret
- [x] 1.2 新增 `focusComposerAfterInsert(caret)`：面板在场才移 → 先 focus → 再写 caret →
      `document.activeElement` 复核，没到位同帧补一次（只补一帧）
- [x] 1.3 三条入口改用它（`insertQuoteCard` / `insertMessageQuoteCard` / `insertQuoteWithImages`）

## 2. 单测（DOM 焦点，三条入口 × 两态）

- [x] 2.1 新增 `tests/unit/harness-quote-focus.test.ts`：面板原本关着 / 原本开着 × 三条入口各断言
      `document.activeElement === composer`（真 `createHarnessPanel` + 平台边界 DOM 替身）
- [x] 2.2 补一条「引用全失败、无卡片可插 → 不偷焦点」的负向（失败读数只落输入区状态行）
- [x] 2.3 反向验证：把三处 `focusComposerAfterInsert(...)` 换成 `void caret` 后 6/7 条必红；
      恢复后 7/7 绿（读数已跑，见完成报告）
- [x] 2.4 `pnpm test` 全绿（1302 条，含新文件的 7 条）

## 3. 真机场景 163b

- [x] 3.1 前台前置换成 `clickEditor real: true`（M670 定因：`focusWindow click: true` 点标题栏
      拖拽区会让 webview 失焦，键盘注入整批停投）
- [x] 3.2 删掉 `clickInNode` 那步假前置；卡片插入后**直接键入**（`do: keys`，素材串不含 'e'），
      判据 = composer 里有串 + `editor.unchangedSince`（编辑器逐字节未变）
- [x] 3.3 浮动钮在场断言改 `waitFor`（M541 时机门 350ms；基线跑实测立即断言抢跑读到退化 AX 快照）
- [x] 3.4 正文「当前状态」段改写成 M671 口径（M669 两层红的归属、假绿形态、判据分层、通道边界）
- [x] 3.5 `node scripts/acceptance/run.mjs --check` 通过（229 个场景）

## 4. 真机复跑

- [ ] 4.1 基线跑（改动前 + 仅改场景）：`node scripts/acceptance/run.mjs 163b` —— 焦点两条断言
      PASS、浮动钮断言因时机门抢跑 FAIL（证据 `.local/acceptance/2026-10-24/163b-harness-quote-first-title/`）
- [ ] 4.2 改动后复跑：`node scripts/acceptance/run.mjs 163b` 全绿（含新前置与 `waitFor`）
- [ ] 4.3 证据落 `.local/acceptance/`，读数摘录进完成报告

## 5. 规格与门禁

- [x] 5.1 `specs/harness/spec.md` delta（MODIFIED「混排对话输入区」+ 一条新 Scenario）
- [ ] 5.2 `openspec validate quote-card-composer-focus-oct24 --strict` 通过
- [ ] 5.3 `scripts/gate.sh quick` 全绿（附 `GATE RESULT` 原文行与退出码）

## 6. 收尾

- [ ] 6.1 证据副本落主仓 `.local/`（worktree 会被清理，指针不能落在 worktree 内）
- [ ] 6.2 有越界发现才报 finding（本次预计无：装配层与粘贴/发送路径都在 non-goals 里）
