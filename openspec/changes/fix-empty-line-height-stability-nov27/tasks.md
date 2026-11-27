# Tasks: fix-empty-line-height-stability-nov27

## 1. 合同与实现

- [x] 1.1 MODIFIED `editor-live-preview`「块边界纵向几何的源码同步稳定性」：普通行局部性 / 非语义迁移稳定 / 语义 reflow 有界三条条款 + 三个新增 scenario（delta 见 `specs/editor-live-preview/spec.md`）。
- [x] 1.2 `src/preview/block-geometry.ts`：普通正文与空行纵向 padding 恒 0（删除「下一行是块边界」「本行是文档末行」两条判断）；移除已无消费者的 `boundary` / `chain` 返回字段；标题阶梯、列表 2px、引用 / 代码 / 表格 / HR 原值保留。
- [x] 1.3 合同文档同步：`docs/specs/lists.md` L8（前行 8px 块末下距 → 恒 0）、`docs/specs/design-tokens-v1.md` 的 doc-body 段落间距。

## 2. 测试（先红后绿）

- [x] 2.1 纯函数矩阵（`tests/unit/block-geometry.test.ts`）：局部性、非语义迁移、57 行同族、heading↔text、Enter 拆合、视口片段同值。旧实现 7 红 / 6 绿，终态 13 绿；红日志 `.local/reviews/empty-line-height-nov27/evidence/unit-red-master.log`。
- [x] 2.2 新增浏览器场景 `tests/visual/scenes/empty-line-height-stability-nov27.spec.ts`：末行输入首字（行盒 / active gutter / END / 总高）、`a\n → a\nx`、57 行、heading↔text（前行不变 + 后行位移 = 获批高度差）、Enter 拆合、DOM↔CM heightmap↔gutter 对账、滚出滚回、selection/focus、IME（CDP）。旧实现 15 红 / 2 绿，终态 17 绿；红日志 `…/evidence/visual-red-master.log`。
- [x] 2.3 旧 8px 期望值按终态修改（反向证据）：`block-boundary-geometry.spec.ts` 前行 `padding-bottom` 8px → 0px 并新增 EOF 单行用例；`markdown-editing-stability.spec.ts` 33.5 → 25.5、8 → 0。
- [x] 2.4 m399（空行正常行高）与 m647（caret 几何）**一字未改**，在终态下保持绿。

## 3. 视觉材料（候选，不更新正式基线）

- [x] 3.1 10 个合成 fixture × 当前 master / 候选两版构建：before/after 截图（裁到编辑器顶部 380px）+ 逐行 DOM 读数 JSON，落 `.local/reviews/empty-line-height-nov27/shots/{before,after}/`。
- [x] 3.2 审阅页 `.local/reviews/empty-line-height-nov27/index.html`：内置可点击控制面板（场景 / 初始·操作后 / 并排·单张·交替闪烁 / 参考线 / 隐藏面板），query 深链 `?case=&state=&mode=&panel=0&guides=0`，含「同一构建内动作前后位移」表（缺陷直接读数）与合同 / 代价说明。
- [x] 3.3 本地全量视觉像素层的报红基线逐条收集、候选截图归档（见交付说明与审阅页）。
- [x] 3.4 基线更新（Alex 2026-11-27 批准原话「接受。可以安排。」）：只更新已审阅的 13 张（`baselines.json`）；更新前核对候选 actual 与审阅页逐字节一致（sha256 13/13），更新后 13 张基线 == 审阅候选（13/13）。
- [x] 3.5 **清单外同源差异的发现（未更新，待追认）**：首轮 13 张清单漏计 4 张——`wrap-combo-2`（22007px / 2.29%）、`wrap-combo-3`（25748px / 2.68%）、`wrap-combo-4`（36183px / 3.77%）、`typography-font-size-24`（9004px / 0.94%）。原因：`expectScreenshot` 失败即抛错，上一轮全量视觉在同一测试的 `wrap-combo-1` / `typography-custom-font-20px` 处中止，后续 4 张截图从未被比较。候选截图与读数在 `.local/reviews/empty-line-height-nov27/` 的 `candidates-extra/` + `baselines-extra.json`；正式基线保持旧图未动（按「只更新 13 张」的指令，不扩大基线面）。

## 4. 验证

- [x] 4.1 `node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/block-geometry.test.ts`：13/13 绿。
- [x] 4.2 根 `tsc --noEmit` 与 `tests/visual` 的 `tsc --noEmit`：通过。
- [x] 4.3 `scripts/gate.sh quick`：通过（含 docs-check / openspec validate / bindings 漂移）。
- [x] 4.4 目标视觉：新场景 17/17 + `m399` / `m647` / `block-boundary-geometry` / `markdown-editing-stability` 共 179/179 绿。
- [x] 4.5 `LUMIR_VISUAL_STRUCTURAL=1 scripts/gate.sh visual`：`GATE RESULT: 13/15 PASS`——唯一红项是 `editing-oracle` 的「IME 组合结束越过 4s 截止」WebKit 计时用例（候选孤立复跑 13/14 绿、master 同样 8/10 绿，判定既有 flaky，证据 `.local/reviews/empty-line-height-nov27/evidence/flaky-ime-timer.md`）；其余结构层 / 前端单测 / 隔离断言全绿，像素断言按 CI 口径跳过并留痕。
- [x] 4.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：PASS。
- [x] 4.7 `node scripts/openspec-archive-check.mjs` 门禁模式：PASS（MODIFIED 无静默丢段）。
- [x] 4.8 rebase 到 `origin/master` `94039023` 后复跑：保留 master 的迁移矩阵 / replace 注册表 / 证据治理制品（无冲突覆盖）；`gate.sh quick` `GATE RESULT: 13/13 PASS（SKIP 0）`。

## 5. 留待后续（不在本 mission 内执行）

- [x] 5.1 **基线批准与更新**：Alex 审阅候选后原话「接受。可以安排。」（2026-11-27）批准方向与 13 张差异的正式更新；已按批准只更新 13 张（见 3.4）。
- [x] 5.2 **真机场景 100 扩展**：用例 5（末尾两个换行，**编辑器 AXTextArea 的 `geom` record / unchangedSince** + `allowOutside` + `compare: ["w","h"]`、落字正观测、未落盘）与用例 6（单尾随换行，落字前后截图留证）；fixtures `empty-line-long-2nl.md` / `empty-line-long-1nl.md`；`run.mjs --check` PASS、COVERAGE 已重生成。
- [x] 5.2b **首轮真机失败修正（test-only）**：END 的 `AXStaticText` 无 bbox（证据 `.local/acceptance/2026-11-27-empty-line-height/`），不能作几何判据。改用编辑器 `AXTextArea`（role + fixture 文本限定）的 bbox 高度——真机读到它就是**文档内容总高**（2nl 2689 / 1nl 2646，一行差 43px），判据取 `compare: ["w","h"]`（位置随滚动，不掺入）与 `allowOutside`（盒高于视口）。`geom` 新增这两个选项（默认行为不变）+ 自测；浏览器层对同一量（`.cm-content` 盒高）有红绿读数：旧模型 1815.5→1823.5（+8），候选 1575.5→1575.5（0）。产品代码未动。
- [ ] 5.3 **追认 4 张清单外基线**：Alex 对 3.5 的 4 张同源差异（候选图见审阅页「清单外同源差异」段）作一次性追认后更新；更新后全量视觉应为全绿（当前最终全量视觉 1933 passed / 2 failed，失败即这 4 张所在的 2 个测试）。
- [x] 5.4 **真机执行**：场景 100（含用例 5/6）真机复跑 **PASS：39 条断言 / 0 失败**，证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-27-empty-line-height-r2/`。首轮在 END bbox 处失败（产品字符输入与其它断言正常），按 5.2b 改判编辑器 AXTextArea 后 r2 通过。
- [ ] 5.5 节点 2 归档记录（独立 reviewer clean/merge + 门禁与证据齐后由 tower 办理）。
