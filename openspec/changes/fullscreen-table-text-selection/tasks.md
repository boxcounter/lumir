# Tasks: fullscreen-table-text-selection

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 动工前先读 [design.md](design.md) §3（已排除的候选）与 §5（为什么不进键位表）——这两节决定了
> 修法的形状，绕开它们容易做成「在键位层再加一条绑定」那种当场被构造期拒绝的写法。

## 0. 提案（节点 1）

- [ ] 0.1 起草 `proposal.md` / `design.md` / `specs/editor-live-preview/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决）
- [ ] 0.3 复核 Alex 的现场：如果他的体验是「鼠标拖选也选不中」，先按 design §6.3 做真机探针，
      再按探针读数补本文件的实现项——MUST NOT 跳过探针直接按现有猜测动手

## 1. 实现

- [ ] 1.1 新增 `src/overlay-select.ts`：`selectAllOf(root)` 一份实现（取 `getSelection` →
      `removeAllRanges` → `Range.selectNodeContents` → `addRange`）；两个遮罩只传各自的内容根，
      MUST NOT 各写一份「怎么选中」
- [ ] 1.2 `src/table-fullscreen.ts`：既有 `keydown` 监听里、`handleKeyToken` 之前加一档
      `Cmd-a` → `preventDefault` + `selectAllOf(快照容器)`；遮罩元素上的监听器只在遮罩持焦时收到该键，
      MUST NOT 另加「现在开着吗」判据
- [ ] 1.3 `src/code-block-fullscreen.ts`：同形，内容根 = 内容容器（`.lumir-codeblock-fs-content`）
- [ ] 1.4 `src/style.css`：`.lumir-table-fs-snapshot` 补 `user-select: text`（与
      `.lumir-codeblock-fs-content` 同款，`src/style.css:1881`）；MUST NOT 新增其它视觉样式
- [ ] 1.5 菜单路径（D3）：两个遮罩端口各加一个 `selectAll()`（内部复用 1.1），
      `src/main.ts` 的 `selectAllByFocusedFace` 加一档「遮罩开着 → 选遮罩内容」；MUST NOT 在装配层
      直接查遮罩 DOM
- [ ] 1.6 回归面自检：四条关闭路径、单实例语义、`Tab` 挡在遮罩内、焦点交还口径一行不动；
      `[keys]` 改绑 ⌘A 后遮罩内行为不变（与 Esc 同款，写进实现注释或 design 引用即可）

## 2. 判据（先造 FAIL，再改代码）

- [ ] 2.1 视觉场景 `tests/visual/scenes/m642-overlay-select-all.spec.ts`：表格全屏 ⌘A → 选区非空、
      锚点在快照容器内、含首行 cell 文本、**不含**遮罩外标题（负向）；剪贴板（chromium 授权读）与
      选中文本一致
- [ ] 2.2 同场景覆盖代码块全屏（锚点在 `.lumir-codeblock-fs-content` 内）与鼠标跨 cell 拖选
      （选区落在遮罩内、文本与 cell 可见文本一致）
- [ ] 2.3 同场景覆盖「选中后 Esc」：遮罩关闭、DOM 选区清空、焦点回编辑器（行为判据用既有
      「⌃D 真删一个字符」口径，不读布尔口）
- [ ] 2.4 **反向验证**：在基准提交上先跑 2.1–2.3，确认它们**红**（⌘A 的选区锚点在遮罩外）；
      红了再改代码，绿了再提交（REVIEW.md『断言等价于子串』条的口径）
- [ ] 2.5 把该场景加进 `tests/visual/playwright.config.ts` 的 `webkit-realua` project `testMatch`，
      真机同款 UA 下复跑（选中是引擎差异敏感面）；剪贴板读不到时该断言降级为「选区内容」并在场景里
      写明原因
- [ ] 2.6 真机复核（真机期向 tower 申报整窗时段）：`pnpm tauri dev` 起真实 app，在合成验收 vault 的
      表格全屏里**手工拖选 + ⌘C**，确认「拖选可选、复制得到表格文本」；读数与截图落 `.local/`。
      若拖选在真机上也选不中 → 停下，按 design §6.3 先定位再回到实现
- [ ] 2.7 真机验收场景：新增一条「遮罩内 ⌘A 之后 Esc 仍关闭、焦点回编辑器」的场景（选区与复制不在
      真机判据内——AX 不暴露选区、原生 ⌘C 注入不落地，场景头注记理由）；场景编号按批次编号纪律现取，
      并在 README 的场景清单里登记
- [ ] 2.8 回扫既有场景：断言不因新增的 `keydown` 分支而变（既有 `m240` / `m277` / `m280` 三个全屏
      场景全跑一遍；`node scripts/acceptance/run.mjs --check` 通过）

## 3. 校验

- [ ] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 3.2 `bash scripts/docs-check.sh` 通过
- [ ] 3.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 3.4 `bash scripts/gate.sh visual` 全绿（动过 `src/style.css`，必须本地跑）；整页基线应**零更新**，
      出现差异即说明改到了不该改的地方
- [ ] 3.5 信息卫生清扫：场景与文档对改动面做一次 text 级 grep（真实 vault 内容、真实路径不落库）

## 4. 收尾

- [ ] 4.1 tower 在批次收尾登记归档跟踪；归档前逐条对账 tasks / spec 增量 / 实现
- [ ] 4.2 M634（`add-harness-block-fullscreen`）归档后，另立一条微型 change 把 harness 面的同族条款
      补进 living spec（design §8；MUST NOT 在本 change 里伪造 MODIFIED）
