# Tasks: move-harness-to-pane-chat-frame

> **勾选状态（M349 收口，2026-10-06）**：1.x–5.1 由三批实现并合并（容器/标题栏 → 控制行/复制/进度 →
> 发送-停止中断），6.1/6.2 由 M349 复核（本地门禁 + 真机批次）。每条括注证据（文件:行 / 单测名 / 场景名 /
> 门禁输出）；拿不出证据的不勾。**6.3 与 6.4 保持未勾**，理由见各自条目——前者等 Alex 过目视觉候选后由
> tower 执行重刷，后者卡在一条 scope 外、与本 change 无关的视觉断言失效上（详见文末「已知未闭环」）。

## 1. 容器改造：harness 归位 pane，dock 移除

- [x] 1.1 装配层：harness 面板挂载从 dock 列改为 pane 内容件（面板接口不动，ADR 0008 survey 的窄接口口径）；`⌘⇧A` 与标题栏 toggle 钮语义改「在旁侧 pane 打开/收起」（无第二 pane 自动分栏、默认 1:2；已有第二 pane 则其标签并入另一 pane 后换位）　**证据**：`src/main.ts:765`（`toggleHarnessPane`）/`:773`（`openHarnessPane`，已有第二 doc pane 先并标签收拢）/`:791`（`closeHarnessPane`）/`:681`（`HARNESS_DEFAULT_DOC_RATIO = 2/3`，无存储比例时生效）；`src/pane-layout.ts` 的 `PaneKind`；真机场景 `86-harness-pane-toggle`（⌘⇧A 自动分栏 + 会话文件 `pane_split_ratio` = 0.666…）；视觉 `m303-harness-panel.spec.ts:64-84`（面板挂旁侧 pane、两列骨架、pane 宽比 1.8–2.2）
- [x] 1.2 dock 列移除：`--layout-dock-w`、`.dock-open`、骨架 grid 第三列及关联代码清扫　**证据**：`rg 'layout-dock-w|dock-open'` 在 `src/` 只余注释（`src/style.css:331`、`src/harness-panel.css:53`、`src/harness-panel.ts:6` 的沿革说明）；视觉 `m303-harness-panel.spec.ts:71-77`（分隔条在场 + `gridTemplateColumns` 长度 2 + 无 `dock-open` 类）、`restyle-skeleton.spec.ts:69-73`（行/列形状与 token 逐项一致，第三列消失）
- [x] 1.3 空 pane 只读条款显式排除 harness pane；pane 命令族对 harness pane 的语义（close = 关 harness、other 可切、split 无操作）　**证据**：`src/main.ts:747`（`splitActivePane`：harness 在场时 `addPane` 返回 null ⇒ 无操作）、`:756`（`activateOtherPane`：目标是 harness 则 `focus()` = 聚焦 composer）、`:814-821`（`closeActivePane`：活跃是 harness → `closeHarnessPane`；活跃是 doc 而旁侧是 harness → 无操作）；真机场景 `86`（⌥W 于 harness pane = 关 harness、标签不丢）+ `79-pane-split`（doc pane 交互未回归，同批 PASS）
- [x] 1.4 `harness_pane` 字段消费：按 vault 恢复面板在场（空会话）；旧版会话文件按 false 兼容　**证据**：`src-tauri/src/vault_session.rs:72`（契约字段）+ `SessionFile` 的 serde default（旧 v2 缺字段按 false）；`src/main.ts:692`（`applyStoredLayout(…, harnessPane, …)`，恢复路径不抢焦点）；`src/vault-switcher.ts:558-562`（`session?.harness_pane ?? false`）；单测 `vault_session.rs` 的 round-trip / 缺字段用例；真机场景 `91-harness-pane-restore`（启动按存储装配 + 切走不泄漏 + 切回重建，空会话）

## 2. 标题栏

- [x] 2.1 harness 段：会话名下拉（含新建会话动作项）+ 新建会话钮；段宽按 pane 实际宽度装配层现算、与分隔条像素对齐　**证据**：`src/harness-panel.ts:915-960`（段构建：`.lumir-hp-seg` = 会话名钮 + 新建会话钮；浮层只含「新建会话」一项）；`src/main.ts` 的 `applySplitRatio`（段与标签条共用同一份 `splitRatio` 设 `flexGrow`）；视觉 `m303-harness-panel.spec.ts:87-90`（段在场、名「新会话」、钮文本）与 `:104-108`（浮层一项）；真机场景 `86`（标题栏段读作 `AXButton (新会话)`）。**缺口（如实记）**：「段边界与分隔条像素对齐」没有专门的几何断言——m303 只钉了 pane 宽比，m320 只钉分隔条的 role/orientation
- [x] 2.2 会话名：首条用户消息截断（约 20 字；未发消息显示「新会话」）——裁决点 2 倾向 A 口径　**证据**：`src/harness-panel.ts:1464-1486`（`SESSION_NAME_MAX = 20`、按码点截断 + `…`、命名取首条用户消息的首个非空段落、未发消息回 D330「新会话」）；视觉 `m303-harness-panel.spec.ts:89`（缺省名）。**缺口（如实记）**：「约 20 字截断」与「截断值怎么派生」没有自动判据（单测与视觉场景都没断言这一条），本批次未补
- [x] 2.3 产品标识块移到 traffic 灯区（系统按钮旁）；窄窗 <640px 退让条款与双 pane 右簇退让条款相应修订（标识块不再退 modeline，toggle 钮双 pane 隐藏保留）　**证据**：`src/modeline.ts` 的 split 维删除（退让对象只剩 toggle）；视觉 `m303-harness-panel.spec.ts:98-101`、`titlebar-identity.spec.ts:54-92`（traffic 区在场 + toggle 钉标题栏右端 + 槽位顺序）、`m149-tabs.spec.ts:289-293`（空标题栏可见子元素 = traffic + toggle）、`m320-pane-split.spec.ts:55/91/170`（双栏下标识块仍在 traffic 区）

## 3. composer 控制行

- [x] 3.1 模型 chip：列出 `[harness].providers` 已配置 provider，选择经 `config_set_value` 写回、下一轮生效；chip ellipsis + hover 全名　**证据**：`src/harness-panel.ts:1524`（`applyModelChip`：读数 + D376 读屏名）、`:1557`（`selectProvider` → `configSetValue("harness","provider",id)`，失败回滚读数 + 错误行）；单测 `tests/unit/harness-panel-control.test.ts`（`providerSelection`）；视觉 `m347-harness-composer.spec.ts`（浮层三项 + 当前项 + `__providerWrites` 写回参数逐字 + ellipsis 计算属性）；真机场景 `90-harness-model-chip`（chip 读数 = 配置值 + 浮层截图）。**carve-out**：浮层项在 WKWebView 的 AX 树里不暴露（嵌在 chip `<button>` 内），真机点不到浮层项 ⇒ 「选择 + 写回」的真机判据落视觉层，边界已登记在 `scripts/acceptance/README.md` 的「已知边界」；a11y 缺陷另以 finding 上报
- [x] 3.2 ctx% 读数迁入控制行；超阈值高亮 + ⓘ 钮气泡（向上展开、右缘对齐）；常驻警示句移除；自动压缩与压缩标记不变　**证据**：`src/harness-panel.ts:1016-1030`（控制行三件：模型 chip / 输入区 / ctx 读数 wrap）+ `:1590`（`applyUsage`：单读数 D334、越线加 `is-warn`、ⓘ 钮显隐、气泡文案 D335）；`src/copy-data.ts:728-738`（D334 收缩为 ctx 单读数、cache 列删除）；单测 `harness-panel-control.test.ts`（`usageOverWarn` 边界）；视觉 `m347-harness-composer.spec.ts`（读数文本 / `is-warn` 类 / ⓘ aria-label / 气泡文本 / 低于阈值退场）；真机场景 `76-harness-usage`（`ctx 50%`、无 cache 列、未越线无 ⓘ）与 `87-harness-ctx-warn`（`ctx 90%` + ⓘ + 点开气泡全文）

## 4. 发送/停止、复制、进度

- [x] 4.1 发送钮两态 + Rust core 中断 in-flight 轮次（已产出保留并标注「已停止」、待决批准项收回、JSONL 记录中断）；停止后可继续提问　**证据**：`src/harness-panel.ts:1613`（`applySendPhase`：idle/running/stopping 三态、stopping 禁用挡连点）+ `:1059`（默认 `stopHandler` → `harnessAbort()`）+ `:1947`（`aborted` 事件：定稿流式消息 + 挂 D383 徽标 + 撤下未决批准卡片）；`src-tauri/src/harness/turn.rs:237/331/345`（三个停止检查点）+ `:375`（`abort_turn`：产出保留、`status="stopped"`、JSONL `turn_aborted`）+ `session.rs`（`request_abort` 收批准项）；集成测试 `src-tauri/tests/abort_turn.rs`（六条）；真机场景 `88-harness-turn-abort`（两态翻转 + 阶段行 + mock 12s 在途点停止 → 「已停止」+ 产出保留 + JSONL `turn_aborted` + 回 idle）
- [x] 4.2 复制消息：hover 浮现钮、复制 Markdown 源文本、成功就地将息反馈　**证据**：`src/harness-panel.ts:1640`（`attachCopyButton`：D379 读屏名、`navigator.clipboard.writeText`、成功换 D380 反馈并 1.5s 还原）、`:1635`（`copySources` 单挂源文本——agent = 模型原始输出、user = 发送前原始输入）；视觉 `m347-harness-composer.spec.ts`（`__copied` 记录写入内容）；真机场景 `89-harness-copy-message`（剪贴板逐字 = 该消息源文本 + 负向「不是用户那条」）。**已知边界**：就地反馈「✓ 已复制」不进 AX（读屏名不随复制更新），真机只判剪贴板内容，反馈归视觉层
- [x] 4.3 不定态进度条 + 阶段指示（无百分比）；工具调用完成即折叠一行摘要；eink 明度/线宽表达　**证据**：`src/harness-panel.ts:1004-1014`（进度条 + 阶段行元素）+ `:1619`（随相位显隐）+ `:1623`（`applyStage`：D381/D382 两档）+ `:1707`（工具调用折叠成一行 D343/D344）；`src/harness-panel.css` 的 `.lumir-hp-bar-fill` 动画与 eink 分叉（明度双档、轨道线宽）；视觉 `m347-harness-composer.spec.ts`（进度条显隐 + 阶段两档）；真机场景 `88`（阶段行「等待响应…」在场/离场）。**已知边界**：进度条本身是无 role 的 div，AX 读不到，真机只判阶段行；条形与动画归视觉层

## 5. 文案与文档

- [x] 5.1 文案表 zh/en 双档（harness 段、模型 chip、ⓘ 气泡、已停止标记、复制反馈、阶段指示等全部新可见文案）+ 文案-Copy.md 同步　**证据**：`src/copy-data.ts` 的 D375（段读屏名）/D376–D380（chip、ⓘ、两态、复制、反馈）/D381–D382（阶段）/**D383**（已停止）/**D384**（`harness_not_running` 错误信封）；漂移与占位门禁 `tests/unit/copy.test.ts`（`docs-check.sh` 与 gate quick 均绿）；`文案-Copy.md` 逐字对账同批落地

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过　**证据**：`Totals: 22 passed, 0 failed (22 items)`（M349，本 worktree）
- [x] 6.2 真机验收：`⌘⇧A` 分栏/收起不丢标签、`harness_pane` 往返恢复、ctx% 位置与 ⓘ 气泡、停止中断（mock 长流）、复制（clipboard 断言）、模型写回；既有 dock 场景改写 pane 口径　**证据**：真机批次 `node scripts/acceptance/run.mjs 70 … 91` → **22/22 PASS**，证据 `test-results/acceptance/2026-10-06/`（`summary.md` + 各场景 `steps.md`/`shots/`）；新增场景 `86`（分栏/收起/默认 1:2/pane.close）、`87`（ctx 越线 ⓘ 气泡）、`88`（发送-停止 + 中断）、`89`（复制剪贴板）、`90`（chip 读数 + 浮层）、`91`（harness_pane 往返）；既有 harness 场景 70–78、81–85 的措辞与结构断言改写为 pane 口径。**两处 carve-out（都有登记，不是漏判）**：① **模型写回**判据落视觉层（浮层项不进 AX 树，见 3.1 与 `scripts/acceptance/README.md` 的「已知边界」）；② 场景 `70` 另按已变更的合同改写——`add-harness-quote-cards` tasks 4.1 移除了「选区自动注入」，chip 由「选区 N–M 行」改为「视口 N–M 行」，而 70 当时没跟改（M349 首跑实测两轮判红，根因非 pane 化）
- [ ] 6.3 视觉：dock 移除 / 标题栏 / 控制行 / 进度态基线批次末一次性重建（Alex 过目后 `--update`）；dock 元素相关整页基线时间戳逐张核对　**状态：候选已产出，待过目与重刷（不勾）**。证据与清单落在 `test-results/alex-review-2026-10-06/`（git 外）：`说明.md` 索引 + 两组子目录各 8 张「旧 / 新 / 差异」三联图（来源 = 本地全量跑 `LUMIR_VISUAL_PORT=4273 bash scripts/visual/run.sh` 的失败实拍）。**核对结论（防静默假绿）**：dock 元素出现过的三张整页基线（`harness-panel-open`、`m345-harness-quote-card`、`m345-quote-jump-flash`）时间戳都停在摘录卡片那轮、均超容差 FAIL，在候选里；**另有二十余张整页基线只差 440–561 像素（< 960 容差）而静默通过**（实测 `app-main` 440、`math-rendering` 561，差异全落在标题栏那一条），故建议重刷用 `--update-snapshots=all` 而非默认的 `=changed`
- [ ] 6.4 `scripts/gate.sh quick` + `visual` 全绿　**状态：quick 全绿 ✓；`visual` 只剩 6.3 的 8 张像素基线陈旧（全量像素模式必红，结构层已全绿）——等 6.3 重刷后即可勾**。逐档读数：`gate quick` **10/10 PASS（SKIP 0）**；`LUMIR_VISUAL_STRUCTURAL=1 LUMIR_VISUAL_PORT=4273 bash scripts/visual/run.sh`（CI 口径）**606 passed / 1 skipped / 0 failed**；全量像素模式（本地口径）**598 passed / 8 failed / 1 skipped**，8 红全部是 6.3 的基线陈旧，无行为断言红。**M349 已修掉的那条**：`tests/visual/scenes/m347-harness-composer.spec.ts` 的桩补一条 `harness_abort` 拦截（成功返回、不发终态事件，相位停在 stopping）——本 change 的 4.1 把默认停止钩子接成真实 `harnessAbort()` 之后，旧桩会走 `origInvoke` 抛错、catch 立刻 `finished` 收口，该断言必红；这条修复经 tower 批准并入 M349 scope（原 finding `20261006-worker-hp4-bug-m348-m347-stopping-harness-abort.md` 可据此关闭）

## 已知未闭环（交给后续动作）

1. **6.3 / 6.4**：等 Alex 过目 `test-results/alex-review-2026-10-06/` 的两组三联图 → tower 执行重刷（**建议 `--update-snapshots=all`**，理由见 6.3 与候选索引 `说明.md`）→ 勾 6.3；`gate.sh visual` 随即全绿 → 勾 6.4。
2. **2.1 / 2.2 的覆盖缺口**：harness 段与分隔条的像素对齐、会话名「约 20 字截断」的派生，都没有自动判据（本批次如实登记未补）。
3. **a11y finding**：模型 chip 的 provider 浮层与会话名浮层嵌在 `<button>` 内，WKWebView 的 AX 树不暴露浮层项 ⇒ 读屏不可达（会话名浮层同构）。finding `20261006-worker-hp4-bug-chip-button-wkwebview-ax.md` 上报中；修法是把浮层挪出按钮或补 `aria-owns` / `role=menu` 语义。**连带影响**：3.1 的「选择 + 写回」真机判据在这条修掉之前只能落视觉层。
4. **真机覆盖缺口（非本 change 引入，如实登记）**：场景 `78` 里「切回 A 看得到自己的会话」不判——同一 vault 的两种路径拼写各自建会话（见那条场景的覆盖边界）；harness 会话内容不跨启动保留是设计口径。
