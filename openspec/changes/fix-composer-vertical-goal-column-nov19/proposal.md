# Proposal: composer 竖直移动的列位改回行内字符列

- Change ID: `fix-composer-vertical-goal-column-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**由 Alex 在真机 dogfood 中直接指令**（2026-11-19）。原话（mission 转述的
> 真机读数）：「最终 master 8814bbf 真机 140 FAIL：前置文本 `yabzcdw\nmn`，caret 在 `mn` 后，
> ⌃P 再输入 p，期望 `yapbzcdw`（上一行同列 2），实际 `yabpzcdw\nmn`（列 3）；⌃N 后续 q 通过。
> 其余 9 条 composer 自动真机 PASS、0 INVALID。」并指令「新 findings 直接安排修复，合同先行且
> 不弱化真机断言」。节点 2（归档评审）：实现完成后填写。

## Why

M831（change `move-composer-to-codemirror-nov18`）把 composer 换成 CM6 文本内核，⌃P / ⌃N 直接
映射到 `cursorLineUp` / `cursorLineDown`。CM 的竖直移动把 goal column 当**像素 x**
（`view.moveVertically` 用 `coordsAtPos` 测光标左缘、落点用 `posAtCoords` 取最近字符边界）。

composer 的字体是比例字体（`--font-sans`，13px SF Pro）。真机 140 的现场：

| 量 | 值 |
|---|---|
| 第二段 `mn` 行尾 caret 的字符边界 x | contentLeft + 18.75px |
| 第一段 `yabzcdw` 的字符边界 | 0 / 6.72 / 13.81 / 21.53 / … |
| 18.75 的最近边界 | 21.53（列 3）而不是 13.81（列 2） |

于是「同列 2」按 ⌃P 变成列 3：`yapbzcdw` → `yabpzcdw`。修复前双引擎探针（Chromium + 真机同款
UA 的 WebKit）读数一致：`moveVertically` 落点 head=3、`goalColumn=18.75`；键入 p 得 `yabpzcdw`。

同一现场在换内核前是绿的：140 在 `.local/acceptance/2026-10-28-m767-chord/` 全 PASS，旧实现
`caretRangeFromPoint` 在同一 x 上两个引擎都返回 pos 2（引擎取整向左），所以「列 2」不是偶然的
绿线，而是当时真机上实际交付的行为。M457 的「同 x 位」措辞因此与真机交付的字符列口径并存，
本 change 把口径收敛到**行内字符列**（Emacs `previous-line` / `next-line` 的 goal column 语义）。

## What Changes

1. `src/harness-composer.ts`：⌃P / ⌃N 与 ⇧⌃P / ⇧⌃N 改为「行选交给 CM、列位按行内字符列」——
   `moveVertically` 只用来选目标渲染行，落点按 `moveToLineBoundary(..., includeWrap)` 取到的行端
   与字符列重算；goal column 以字符数沿用 `SelectionRange.goalColumn`（调用 `moveVertically` 前
   剥掉，避免被当像素）。
2. 语义边界不变：非空选区先折叠、文档首 / 末行回落行首 / 行尾、扩选 anchor 不动、导航只写
   selection（不产生编辑 history）、软折行仍逐渲染行移动。
3. `docs/specs/harness-composer.md` HC1 增第 5 条（合同先行），140 场景补负向断言（像素口径的
   缺陷签名不在场），不弱化原正向断言。
4. 单测与浏览器回归：composer-nav 单测的假 view 改为像素 goal column 模型（否则列位断言修前也绿，
   是假绿），新增 9 条列位用例；m831 视觉场景新增 5 条浏览器回归（Chromium + WebKit 实跑）。

## Non-goals

- 不改编辑器正文（`src/editor.ts`）的竖直移动口径——它的 goal column 仍是 CM 像素语义，本 change
  只约束 composer。
- 不引入 DOM caret 模型、不读 DOM Range 几何、不重建 M457 的 `caretRangeFromPoint` 路径。
- 不改键位表、不改 AX 判据通道、不更新像素基线。
