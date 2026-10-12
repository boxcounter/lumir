# Proposal: 把块级横滚容器的焦点入口对齐到 M474 实现（⌃⌥S）

- Change ID: align-block-scroller-focus-entry
- 日期: 2026-10-13
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **补记（retro）change**——实现先于规格落地；本 change 不新增行为，只把 living spec 与实现对齐

## Why

`openspec/specs/keymap-commands/spec.md` 与 `openspec/specs/editor-live-preview/spec.md` 里关于
「块级横滚容器怎么拿到焦点」的三处记述停留在 M239（`Tab` 被判给列表缩进）之后的状态，与 M474 的实现
直接矛盾：

1. `keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一键位表」requirement 的「焦点入口（本 change 后的
   实测状态）」段写「**当前没有任何真机验通的路径**把焦点送进容器」，并把「恢复焦点入口的候选」推给后续
   change；M474 已取该候选（新命令 `editor.focus-block-scroll` + 默认绑定 `⌃⌥S`）落地。
2. 同 requirement 的 Scenario「代码块容器与表格容器同判据同行为」写「**本版起真机没有产品入口**……
   键盘行为由 chromium 层以**编程聚焦**承担」——真机入口已由 `⌃⌥S` 提供。
3. `editor-live-preview` 的「折行渲染与代码块横滚容器」requirement 的 Scenario「代码块容器的键盘可达性」
   写「用 `Tab` 把焦点移入代码块横滚容器」——`Tab` 早已不构成入口（列表缩进命令接管），现入口是 `⌃⌥S`。

事实依据（实现已在 master）：`src/keys.ts:635` 的默认绑定 `Ctrl-Alt-KeyS → editor.focus-block-scroll`、
`src/editor.ts:2028` 的命令注册、`src/preview/livePreview.ts:558` 的 `focusBlockScroll(view)`——把焦点
交给 caret 所在块的横滚容器；caret 不在块内、或所在块没有容器（`editor.code_block_wrap = true` 的折行档）
时静默无操作。落地提交 `0237f43`（M474）。

## What Changes

两份制品、两条 MODIFIED requirement 的措辞收口，**零代码改动**：

1. **MODIFIED `keymap-commands` / 轨道 D 的 widget 滚动键纳入统一键位表**：把「没有入口 / 候选记在
   backlog」的段落改写为 M474 口径——`editor.focus-block-scroll`（`⌃⌥S`）把焦点交给当前光标所在块的
   块级横滚容器，折行档无容器时静默无操作；Scenario「代码块容器与表格容器同判据同行为」的 `WHEN` 由
   「chromium 层编程聚焦」改为真机按 `⌃⌥S` 进入。
2. **MODIFIED `editor-live-preview` / 折行渲染与代码块横滚容器**：Scenario「代码块容器的键盘可达性」的
   `WHEN` 由「用 `Tab` 把焦点移入」改为「把光标放进代码块后按 `⌃⌥S`」。

## Non-goals

- 不新增任何产品行为：本 change 的 requirement 全部描述已发布实现，MUST NOT 被读作「新功能承诺」。
  `⌃⌥S` 的键位来由与冲突核对已记在 `文案-Copy.md`（D461）与 `src/keys.ts`，不在此重述。
- 不改 `editor.focus-block-scroll` 的实现或默认绑定。
- 不改本 requirement 里与焦点入口无关的条款（五条滚动键的行为、命中条件、与 `keymap-unify` 的取代关系）。

## Impact

- 影响的 specs：`keymap-commands`（1 条 MODIFIED）、`editor-live-preview`（1 条 MODIFIED）。
- 影响的代码/系统：无——实现已在 `src/keys.ts` / `src/editor.ts` / `src/preview/livePreview.ts`。
- 关联约束：ADR 0003 §3（装饰不改写源文件——本键只移动焦点，不动文档）。
