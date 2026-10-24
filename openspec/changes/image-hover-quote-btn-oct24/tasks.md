# Tasks: image-hover-quote-btn-oct24

## 1. 定因（探针）

- [x] 1.1 临时 DOM 探针（`src/preview/m670-probe.ts`，提交前删除）：把「钮在不在 DOM / `:hover` 命中
      数 / mousemove 计数与最后落点 / `:hover` 链 / `document.hasFocus()` / 可见性」渲染进一个固定层，
      经 AX 快照读出
- [x] 1.2 A/B 读数：标题栏单击前 vs 后各悬停同一张图；同批跑场景 87 作对照组
- [x] 1.3 定因结论落盘 `.local/probes/m670-hover-probe.md`（含读数原文与影响面）

## 2. 场景 222（真机判据）

- [x] 2.1 前置改成「正文真实单击」（`clickEditor real: true`）：一步同时建立前台、key window 与
      webview 焦点；就地写清 MUST NOT 用标题栏单击（拖拽区）
- [x] 2.2 ① 悬停前加负观测（钮不在读屏树）——正观测的区分度前置
- [x] 2.3 ② 段扩选两次 → 三次（图片行真正进选区），并补「含 1 张图片」正观测
- [x] 2.4 ④ 段加「指针移到非图片目标 → 钮退回静止态」负向（可见性双向的产品判据），并去掉该段的
      标题栏单击
- [x] 2.5 `node scripts/acceptance/run.mjs --check` 通过

## 3. 视觉层（chromium，产品不变量）

- [x] 3.1 `tests/visual/scenes/m633-image-quote.spec.ts`：位图用例补「移开后重新不可见」
- [x] 3.2 同文件 svg 用例补三态（静止不可见 → 悬停可见 → 移开不可见）
- [x] 3.3 反向验证：删掉 `src/style.css` 的 `.cm-lp-image-box:hover` 选择器后这两条必红，恢复后绿

## 4. 真机复跑

- [x] 4.1 `node scripts/acceptance/run.mjs 222` 全绿（含 ④ svg 栅格化引用成功段）
- [x] 4.2 证据落 `.local/acceptance/2026-10-24/222-image-quote-to-chat/`，摘录进完成报告

## 5. 规格与门禁

- [x] 5.1 本 change 的 `specs/editor-live-preview/spec.md` delta（ADDED 一条）
- [x] 5.2 `openspec validate image-hover-quote-btn-oct24 --strict` 通过
- [x] 5.3 `scripts/gate.sh quick` 全绿（附 `GATE RESULT` 原文行与退出码）

## 6. 收尾

- [x] 6.1 探针模块 `src/preview/m670-probe.ts` 及其 import 删除（探针不是产品代码）
- [x] 6.2 越界发现报 finding：`focusWindow click: true` 的消费者（163b / 224 / 228）与拖拽区的冲突
- [x] 6.3 证据副本落主仓 `.local/`（worktree 会被清理，指针不能落在 worktree 内）
