# Proposal: 图片悬停引用钮的真机判据修复（前置自毁 + 假绿夹层）

- Change ID: `image-hover-quote-btn-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：Alex 2026-10-24 批准立项（tower 立项口径：「222 真机复跑仍红」的 finding
> 直接转 mission）。本 proposal 无待裁裁决点——修复面停在判据层，产品行为不动。
> 节点 2（归档评审）：实现完成后填写。

## Why

真机验收场景 222（图片摘录到对话）在 2026-10-24 的两次跑批里**从未通过**：悬停编辑器里已渲染的
图片（位图与 svg 各一次），读屏树里始终没有「摘录到对话」钮。这条红同时挡住 M666 把 svg 移进
可引用成功路径之后的真机验证（222 ④ 段）。

M669 的 finding 已经排掉了坐标、key window、注入通道三项，并把方向留给「DOM 级探针」。M670 的探针
（证据 `.local/probes/m670-hover-probe.md`，读数取自真机 WKWebView 的 AX 快照）给出的是相反方向的
结论：

1. **钮一直在 DOM 里**（`btnN=2`，两张图各一个），静止态 `visibility: hidden` 是设计如此。
2. **hover 本身没坏**：webview 有焦点时，注入点在图片盒中心，`:hover` 命中挂载盒、钮 `visibility:
   visible`、读屏树里出现 `AXButton (摘录到对话)`；同一批里场景 87（不做标题栏单击）hover PASS。
3. **打死判据的是场景自己的一步前置**：M669 给 222 加的「真实标题栏单击让窗口成为 key window」
   （`focusWindow click: true`）落在标题栏的拖拽区（`data-tauri-drag-region="deep"`）。这一次单击
   之后，AX 快照里 `AXWebArea (focused)` 标记消失，整页的 `mouseMoved` **整批不再投递**——纯移动
   通道的 hover 从此不更新 `:hover`。
4. **判据因此还带着一条假绿**：通道死掉之后，指针「没被页面认为离开过」，旧的 hover 状态留在页面
   上，于是「hover 后钮在场」照样成立（同一轮 A/B 实测：先把钮悬停出来，再做标题栏单击，随后的
   悬停注入一次 `move` 都没到，断言仍然绿）。这条假绿比红更危险——它让「钮出不来」这种缺陷在
   通道半死时静默通过。

同一个场景的第二个红（② 段「两张卡片」实际 1 张）同样不是产品缺陷：`⌃⇧N` 是「选区头下移一行」，
两次从第 3 行行首扩选只把选区头落到**图片行行首**，而图片枚举的重叠判据是严格重叠（起点等于选区
末端不算命中），于是图片源码没进摘录原文——卡片出处行也因此没有「含 1 张图片」这个角标。

影响面：这是图片摘录唯一入口的真机判据，也是 M666 svg 引用成功口径的唯一真机落点。判据红着的
每一天，这两条能力在真机层都处于「未验」状态（REVIEW.md「覆盖声明超出真实验证」条）。

## What Changes

1. **场景 222 的 hover 前置改成正文真实单击**：`clickEditor real: true`（一步同时拿到前台、key
   window 与 webview 焦点），删掉两处 `focusWindow click: true`，并在就地注释里写清为什么
   MUST NOT 点标题栏（落点是拖拽区 ⇒ webview 失焦 ⇒ 移动通道整批停投）。② 段回到编辑器时的
   `clickEditor` 同样改成 `real: true`（非 real 的 KimiCU 坐标点击同样会丢 key 状态，此后的
   `⌃N` / `⌃⇧N` 不落地）。
2. **给 hover 正观测配紧邻的负观测**：① 悬停前先断言「钮不在读屏树」，④ 悬停 svg 前先移动到
   非图片目标并断言「钮退回静止态」。正观测因此有区分度——陈旧 hover 状态骗不过去。
3. **② 段的扩选配方换掉**：`⌃⇧E`（扩选到第 3 行行尾，锚点留在行首）+ `⌃⇧N` ×3，把图片行真正
   括进选区；并补一条「含 1 张图片」正观测把枚举结果钉住，不再只看卡片数。
4. **视觉场景 `m633-image-quote.spec.ts` 补三态断言**（chromium 层，产品侧不变量）：同一张图片
   静止态不可见 → 悬停可见 → 指针移开后重新不可见；位图与 svg 两个入口各一遍。
5. **规格补一条不变量**（`editor-live-preview` ADDED）：图片引用钮的可见性 SHALL 双向跟随指针，
   MUST NOT 依赖「指针曾经到过」的历史状态。

## Non-goals

- **不修产品侧的 hover 实现**：探针证明 `:hover` 链路本身正常，改它没有依据（REVIEW.md「诊断先于
  处方」）。产品代码本 change 一行不动。
- **不动 `focusWindow` 动作本身**（`scripts/acceptance/lib/**` 不在本 mission scope）：它的
  `click: true` 对其它场景（163b / 224 / 228）的影响已按 finding 报给 tower，归属另议。
- **不顺手修 163b**：它的第一红是「⌃⇧N 选区 → 浮动钮浮现」，那条路径不走 hover，与本 change 的
  归因不是同一层；mission 的 scope 也不含它。
- **不把「窗口是否 key」做成套件级守卫**：这一层在纯注入通道里买不到（单击会自毁移动通道），
  真正的判据是「webview 有焦点」而不是「窗口 key」，本 change 只按实测写清前提，不发明新机制。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED「图片引用钮的可见性双向跟随指针」）。
- 影响的文件：`scripts/acceptance/scenarios/222-image-quote-to-chat.md`、
  `tests/visual/scenes/m633-image-quote.spec.ts`、本 change 目录。
- 关联约束：REVIEW.md「假绿：断言看着有覆盖，实际不判任何东西」族（正观测必须有区分度）、
  `scripts/acceptance/README.md` 的 hover 条（前台是硬前提）、ADR 0004（判据必须机器可执行）。
