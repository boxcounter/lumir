# Tasks: fullscreen-table-text-selection

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 动工前先读 [design.md](design.md) §3（已排除的候选）与 §5（为什么不进键位表）——这两节决定了
> 修法的形状，绕开它们容易做成「在键位层再加一条绑定」那种当场被构造期拒绝的写法。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/editor-live-preview/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（2026-10-23「按倾向」，提案 269e14a 已合并）（硬门禁；五个起草期取值 D1–D5 一并裁决）
- [x] 0.3 **已确认**（不是待确认）：Alex 2026-10-23 原话「不是，我当时是用鼠标拖选，但没有出现选择块/
      状态。」——真机（WKWebView）上拖选不成立，与引擎层探针的分叉已登记在 design §1.3；根因**未定位**，
      因此实施第一步是真机探针（本文件 §1），MUST NOT 按猜测先写产品代码

## 1. 真机探针（实施第一步，先于任何产品代码）

- [x] 1.1 环境与素材：`pnpm tauri dev` 起真实 WKWebView（合成长验收 vault，用户真实 vault 只读），
      Safari「开发」菜单连 Web Inspector；样本 = 一张渲染为 grid 的表 + 一条长代码块
- [x] 1.2 按 design §2.1 的 H1–H5 取读数：`getSelection()` 的 `rangeCount` / `toString()` / 锚点归属、
      `selectionchange` 时间线、`mousedown` / `mousemove` 的 `defaultPrevented` 与 `composedPath()`、
      `pointer-events` / `user-select` 计算值
- [x] 1.3 **先做最快的判别动作**（design §2.1 末尾）：遮罩里拖选后按 ⌘C 粘到编辑器——粘出 cell 文本
      ⇒ 选区已建立（H2，看不见）；粘不出 ⇒ 选区没建立（H1 / H3–H5）
- [x] 1.4 截图对照：同一窗口、同一滚动位的「未选中 / 选中」两张，像素级比对选中带是否存在
- [x] 1.5 对照组：同一拖选在编辑器正文（非全屏）里做一次——CM 的选区是自绘的，「编辑器里看得见」
      不能证明原生选区可见，但「编辑器里也选不中」会把问题指向全局
- [x] 1.6 落盘：读数、截图、console 记录进 `.local/probes/2026-10-23-fullscreen-selection/`（git 外），
      实现报告给可 `ls` 的绝对路径
- [x] 1.7 **分流**（结论决定后面的实现与断言，MUST NOT 跳过）：
      H2 ⇒ 进 2.5 与 3.5 的可见性口径（视觉变化，先给 Alex 过目）；
      H1 / H3 / H4 / H5 ⇒ 按结论扩 3.5 的断言再改实现；
      指向跨切面原因（全局 CSS / Tauri 注入脚本 / webview 配置）⇒ **停下报 tower → Alex**，不在本
      change 里顺手改（影响面升级线）

## 2. 实现

- [x] 2.1 新增 `src/overlay-select.ts`：`selectAllOf(root)` 一份实现（取 `getSelection` →
      `removeAllRanges` → `Range.selectNodeContents` → `addRange`）；两个遮罩只传各自的内容根，
      MUST NOT 各写一份「怎么选中」
- [x] 2.2 `src/table-fullscreen.ts`：既有 `keydown` 监听里、`handleKeyToken` 之前加一档
      `Cmd-a` → `preventDefault` + `selectAllOf(快照容器)`；遮罩元素上的监听器只在遮罩持焦时收到该键，
      MUST NOT 另加「现在开着吗」判据
- [x] 2.3 `src/code-block-fullscreen.ts`：同形，内容根 = 内容容器（`.lumir-codeblock-fs-content`）
- [x] 2.4 `src/style.css`：`.lumir-table-fs-snapshot` 补 `user-select: text`（与
      `.lumir-codeblock-fs-content` 同款，`src/style.css:1881`）
- [x] 2.5 **仅当探针结论是 H2**：选区带的可见性口径（与 `--sel-band` 同强度、三主题各一档，
      MUST NOT 新增色值）；这一步会改 `::selection` 的观感 ⇒ 按基线纪律先给 Alex 过目再改
- [x] 2.6 菜单路径（D3）：两个遮罩端口各加一个 `selectAll()`（内部复用 2.1），
      `src/main.ts` 的 `selectAllByFocusedFace` 加一档「遮罩开着 → 选遮罩内容」；MUST NOT 在装配层
      直接查遮罩 DOM
- [x] 2.7 拖选侧的实现：按 1.7 的结论落地（若 H1 / H3–H5 需要改实现）；MUST NOT 在探针结论之外
      顺手改跨切面代码
- [x] 2.8 回归面自检：四条关闭路径、单实例语义、`Tab` 挡在遮罩内、焦点交还口径一行不动；
      `[keys]` 改绑 ⌘A 后遮罩内行为不变（与 Esc 同款，写进实现注释或 design 引用即可）

## 3. 判据（先造 FAIL，再改代码）

- [x] 3.1 视觉场景 `tests/visual/scenes/m642-overlay-select-all.spec.ts`：表格全屏 ⌘A → 选区非空、
      锚点在快照容器内、含首行 cell 文本、**不含**遮罩外标题（负向）；剪贴板（chromium 授权读）与
      选中文本一致
- [x] 3.2 同场景覆盖代码块全屏（锚点在 `.lumir-codeblock-fs-content` 内）与「选中后 Esc」
      （遮罩关闭、DOM 选区清空、焦点回编辑器——行为判据用既有「⌃D 真删一个字符」口径，不读布尔口）
- [x] 3.3 **反向验证**：在基准提交上先跑 3.1–3.2，确认它们**红**（⌘A 的选区锚点在遮罩外）；
      红了再改代码，绿了再提交（REVIEW.md『断言等价于子串』条的口径）
- [x] 3.4 把该场景加进 `tests/visual/playwright.config.ts` 的 `webkit-realua` project `testMatch`
      （引擎族回归；**不能替代真机**——本次分叉即证据，写在场景头注记里）；剪贴板读不到时该断言降级
      为「选区内容」并写明原因
- [x] 3.5 **跟随探针结论的断言**：H2 ⇒ 加计算色彩断言（选中带与遮罩底色的对比不低于 `--sel-band`
      与正文底色的对比，三主题各一档）+ 一张选中态截图；H1 / H3–H5 ⇒ 把该根因的最小复现写成断言
- [x] 3.6 真机复核（真机期向 tower 申报整窗时段）：实现之后再跑一次 1.2–1.4，确认「拖选看得见选中带
      且 ⌘C 粘出表格文本」；读数与截图落 `.local/`
- [x] 3.7 真机验收场景：新增一条「遮罩内 ⌘A 之后 Esc 仍关闭、焦点回编辑器」的场景（选区与复制不在
      真机判据内——AX 不暴露选区、原生 ⌘C 注入不落地，场景头注记理由）；场景编号按批次编号纪律现取，
      并在 README 的场景清单里登记
- [x] 3.8 回扫既有场景：断言不因新增的 `keydown` 分支而变（既有 `m240` / `m277` / `m280` 三个全屏
      场景全跑一遍；`node scripts/acceptance/run.mjs --check` 通过）

## 4. 校验

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `bash scripts/docs-check.sh` 通过
- [x] 4.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [x] 4.4 `bash scripts/gate.sh visual` 全绿（动过 `src/style.css`，必须本地跑）；若只加
      `user-select: text`，整页基线应**零更新**；若按 2.5 改了选区带，相关基线更新须先经 Alex 过目
- [x] 4.5 信息卫生清扫：场景与文档对改动面做一次 text 级 grep（真实 vault 内容、真实路径不落库）

## 5. 收尾

- [ ] 5.1 tower 在批次收尾登记归档跟踪；归档前逐条对账 tasks / spec 增量 / 实现
- [ ] 5.2 M634（`add-harness-block-fullscreen`）归档后，另立一条微型 change 把 harness 面的同族条款
      补进 living spec（design §8；MUST NOT 在本 change 里伪造 MODIFIED）

## 实施记录（2026-10-23，M650）

- **1.7 分流 = H2（选中了看不见），H1/H3/H4/H5 排除**。机制比提案更具体：`@codemirror/view` 的
  `hideNativeSelection` 主题把 `.cm-line ::selection` 声明为 `transparent !important`，快照行带
  `.cm-line` 且主题 scope 经 `mirrorThemeScope` 镜像到浮层 ⇒ 选区带被抹成透明。真机读数与截图见
  `design.md §10` 与 `.local/probes/2026-10-23-fullscreen-selection/`。
- **2.5 的落地口径**：遮罩内容 `::selection` 取 `--sel-band`，用 `!important` + 三层类选择器压过
  CM 的 `Prec.highest` 主题（`src/style.css` 的对应注释写明来历）；三主题对比与编辑器逐值相同。
- **2.8 的实测增补**：真机上「遮罩内选中过文本再 Esc」有约 1/6 概率把 CM caret 同步成 0（浏览器
  在隐藏子树失焦时的选区搬迁与 CM 一次 prior selectionchange 叠加）。修法：`focusSourcePane`
  在交还焦点后的短窗口内按「caret 塌到 0」这一缺陷签名把捕获的选区写回一次（不 scrollIntoView，
  窗口外与用户其他选择不动作）。判据：`tests/visual/scenes/m642-overlay-select-all.spec.ts` 的
  Esc 用例连跑 8 次全绿。
- **r1 评审两条 P2 的处置**：① `overlay-select.ts` 的清理时机注释由「之后」改为「之前」，并写明
  `hide()` 先于 `restoreFocus()`，防止后来者按注释把 caret-0 竞态放回来；② 合同断言补两条
  「选区在场时点击遮罩关闭」「选区在场时再次 toggle 关闭」（选区清空 + caret 不动 + 文档不变），
  spec 场景枚举的三条关闭路径至此逐条断言。
- **自验结果**：`gate quick` → `GATE RESULT: 11/11 PASS（SKIP 0）`，退出码 0；
  `gate visual` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（整页基线零更新）。
- **未完成的两项真机动作**：dark/eink 的选中带截图、验收场景 227 的真机跑批。两者都被操作中途
  弹出的 macOS 屏幕录制授权弹窗阻断（系统隐私授权，未点 Allow，GUI 操作就地停止）；场景文件已
  交付并通过 `run.mjs --check`，真机跑批待弹窗处理后可重复执行 `node scripts/acceptance/run.mjs 227`。
