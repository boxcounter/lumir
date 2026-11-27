# Proposal: END 标记统一到所有已完成布局的 md 文档

- Change ID: `show-document-end-marker-all-docs-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（需求与裁决），AI agent（起草）

## Why

现状（master `9f872e8f`）：正文末尾的「END」标记只在**内容高度 > 可用视口高度**时显示
（`src/preview/endMarker.ts` 的 `endMarkerVisible`）。一屏装得下的 md 文档没有这个终点线索，
用户读到最后一行的下方仍是空白，无法区分「正文到此结束」与「下面还有、只是没滚到」。

Alex 已采纳统一：**所有已完成布局的 md 文档都显示 END**；视口为 0 / 尚未布局时才不显示。
这条口径推翻了 `document-end-marker`（M189）裁决点 3 的「只在装不下时显示」。

只改判据不够：现行 md 布局把正文行钉成 `minmax(max-content, 1fr)`、`.cm-content` 带 CM 基础主题的
`min-height: 100%`。一屏装得下时正文盒被拉到视口高度，END 若仍作为下一行只能落在**视口底部之外**，
正是合同禁止的「被 min-height 推到一屏底」。本 change 保留这条铺满视口的正文行（它同时是 CodeMirror
的原生指针命中面），把 END 改为**绝对定位在正文自然末尾**；「只改判据、保留 in-flow END」的反例实测
见 design.md §2。

## What Changes

1. **出现判据：只判布局完成，不判内容高度**
   - 可用视口高度 > 0 ⇒ md 文档的 END 在场；视口为 0（尚未布局 / 被完全遮挡）⇒ 不在场。
   - MUST NOT 再比较内容高度与视口高度；MUST NOT 依赖滚动位置、光标位置或文档长度。
   - 纯函数 `endMarkerVisible(viewportHeight)` 是唯一判据点；视口变化由 ResizeObserver、文档 / 几何
     变化由 `ViewUpdate` 触发重算。
2. **纵向位置：自然正文末尾之下，不贴窗口底；正文盒保留指针命中面**
   - md 正文行仍为 `minmax(max-content, 1fr)`、`.cm-content` 仍取 CM 基础主题的
     `min-height: 100%`：短文正文盒继续铺满可用高度，正文下方空白仍是 CodeMirror 的原生命中面。
   - END 改为 `.cm-scroller` 上**绝对定位**的 chrome（`pointer-events: none`）：`top` = 正文自然
     末尾（最后一行 + 正文下内边距），`left/width` = 正文盒水平区间；三者由插件在测量周期之外用
     O(1) 布局读数（`contentHeight` + 正文盒矩形）写入，不把滚动位置当判据或落点输入。
   - 纵向间距沿用现行 padding（正文下内边距 20px + 标记上内边距 20px），视觉间距与长文档现状一致。
   - 短文档：END 紧跟末行之下、整体落在视口内；长文档：位置不变，随内容滚动。
   - 视口高度变化只改变可见范围，MUST NOT 改变 END 的纵向位置（位置只由内容决定）。
3. **不变项**
   - 仍是 chrome：不进 `EditorState.doc` / 保存字节 / ⌘A / ⌘F / 文件内搜索，不进 heightmap，
     不参与按视口增量构建的装饰层；code 模式 MUST NOT 出现。
   - **正文下方空白保留 CodeMirror 原生指针行为**：单击空白聚焦编辑器并把光标放到文档末尾；
     双击、拖选继续走 CM 自己的手势路径；点在 END 自身上也穿透到正文盒（`pointer-events: none`）。
     MUST NOT 用只处理单击的自定义转发层替代 CM 手势。
   - **结构性空态不是文档**：分栏空 pane / 首启 tips 这类结构只读的空态 chrome MUST NOT 出现 END
     （与同批「空态无行号 / 无插入光标」的呈现口径一致）；打开带路径文档后结构只读撤下，标记恢复。
   - 标记的形态、配色、文案（「END」）与字号基准不变。
   - 长文档的滚动高度在所有滚动位置恒定；异步图片、缩放、resize、模式切换与行高迁移的行为不变。

## Non-goals

- 不改 code 模式，不改非 md 文件的任何呈现。
- 不改标记的视觉形态、文案、线段长度、字号基准与配色 token。
- 不做阅读进度读数 / 进度条 / 回到顶部等窗口级 UI。
- 不改 `.cm-content` 的上下内边距数值（32px / 20px）与 END 自身的 padding 阶梯。
- 不自造指针手势转发层 / 只处理单击的补丁：空白区的单击、双击、拖选一律走 CodeMirror 原生路径。
- 不更新视觉基线、不跑真机、不归档（由主会话在候选截图过目后安排）。

## Impact

- 影响的 specs：`editor-live-preview`（MODIFIED ×2：「正文末尾的结束标记」「结束标记的非文档性与几何稳定」）。
- 影响的代码：
  - `src/preview/endMarker.ts`（判据、绝对落点的 O(1) 测量、触发点、注释）
  - `src/preview/theme.ts`（正文行保留 1fr、END 绝对定位 + `pointer-events: none`、注释）
  - `src/editor.ts`（结构性空态不装 END）
- 影响的测试：
  - `tests/unit/end-marker.test.ts`（判据真值表）
  - `tests/visual/scenes/end-marker.spec.ts`（短文几何、指针命中行为、视口 0、resize、滚动恒定、M238 / M251 矩阵的期望）
  - `tests/visual/scenes/no-tab-empty-state-nov27.spec.ts`（结构空态无 END / 打开文档后恢复）
  - `scripts/acceptance/scenarios/27-document-end-marker.md`（短文侧改为 END 在场 + 滚动后仍在场）
- 视觉基线：短文场景会新生 END，相关整页基线预期变化；候选截图落
  `.local/reviews/end-marker-all-docs-nov27/`，基线更新是 Alex 的人肉裁决点，本 change 不执行。
- 关联约束：ADR 0003（不改写源文件）、ADR 0002 §6（不新增打开 / 键入路径测量）、ADR 0004（AI-only 开发）、
  `docs/process/rendering-defect-contract-first.md`（不变量条款 + 属性测试先行）。

## 节点 1：批准记录

- Alex 已采纳 END 标记统一（2026-11-27，主会话转达的 mission 合同）：所有已完成布局的 md 文档都显示
  END；视口 0 / 尚未布局才不显示；END 在自然正文末尾之下、不固定窗口底部；短文档不得被 min-height
  推到一屏底；code 模式绝不在场；高度稳定、不引发布局 / 阅读位置 / heightmap 跳动。
- 常规实现细节与测试口径由主会话代裁。

## 节点 2：归档放行记录

### 状态分列

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | `2abc3a3d`（END 统一）、`ca7c5473`（指针命中面 / 绝对定位）、`d6e85033`（27 oracle）、`17c6587a`（审阅收口）、`bc597b3c`（4 张基线 + 归档记录）；均在本分支 |
| released | 否 | 本批不打包；无 release 产物 |
| machine PASS | 是（附 flake 证据） | quick `GATE RESULT: 13/13 PASS（SKIP 0）`；完整 visual `GATE RESULT: 14/15 PASS（SKIP 0），exit 1；visual-regression 1936 passed / 2 failed / 13 skipped，2 failed 为既有 webkit-realua editing-oracle IME 计时用例，隔离复跑 2/2×2 PASS`；docs-check / validate / archive-check 见下 |
| native PASS | 是 | 场景 27 `03-final-pass` **PASS 23 断言**（`.local/acceptance/2026-11-27-end-marker-all-docs/03-final-pass/`）；首轮 oracle FAIL 与反向 FAIL 分列同目录 `README.md` |
| archived | 是 | `bc597b3c`；`--archived` PASS（1 条 MODIFIED / 10 段） |

### 五要件（归档前）

1. **方案已批准**：Alex 2026-11-27 原话「批准 END 的 4 张基线」；combo4 换图后再次原话「批准 END 的第 4 张新基线」。节点 1 口径（所有已完成布局的 md 文档显示 END）已由 Alex 采纳；无静默扩 scope。
2. **独立 reviewer clean / merge**：K3 `k3-verdict-r2.md` **clean/merge**，绑定 `17c6587a`；combo4 新候选另有 `k3-combo4-verdict.md` **clean**，绑定同一 tip。两文件均在 `.local/reviews/end-marker-all-docs-nov27/`。
3. **tasks 完成**：`tasks.md` 全部勾选（无放弃项）；含 P3 收口、27 oracle、基线更新、完整 visual 与归档记录。
4. **门禁与真机证据**：quick `GATE RESULT: 13/13 PASS（SKIP 0）`（`evidence/gate-quick-review-clean.log`）；完整 visual `GATE RESULT: 14/15 PASS（SKIP 0），exit 1；visual-regression 1936 passed / 2 failed / 13 skipped，2 failed 为既有 webkit-realua editing-oracle IME 计时用例，隔离复跑 2/2×2 PASS`（`evidence/gate-visual-final.log`）；真机 27 最终 PASS 23 断言（上述 `03-final-pass`）。
5. **规格对账无丢段**：`openspec validate --all --strict` 39/39；`node scripts/openspec-archive-check.mjs` PASS；`docs/backlog.md` 归档队列本 change 唯一一条。

### combo4 基线换图原因（Alex 第二次批准）

- 首次批准的 combo4 候选 `78b72663…` 生成于最终布局 `ca7c5473` 之前（自然高度实现），在 `17c6587a` 上不可复现：正文更低约 76px、END 在视口下方；最终 actual `1b37b892…` 两次相同。
- 根因是最终布局 `.cm-content` 铺满视口后，combo3→combo4 的 CM 滚动锚定保持 `scrollTop=51`；旧布局调到 127。不是测试抖动或产品缺陷；`combo4-recheck.md` 有完整读数。
- 只更新 combo4 这一张；combo1-3 沿用首次批准 SHA，未改容差、未更新第 5 张。

### 归档前后

- **归档前**：四张基线已按上述 SHA 写入；完整 visual 1936 passed / 2 failed / 13 skipped，2 failed 为既有 webkit IME flake（隔离 2/2×2 PASS），`GATE RESULT: 14/15 PASS（SKIP 0）` exit 1；`validate` / `archive-check` / `docs-check` PASS；队列唯一条目。
- **归档提交**：`bc597b3c`（含归档目录、living spec、4 张基线、`tasks` / `proposal` / `backlog`）。
- **包装器**：`node scripts/openspec-archive.mjs show-document-end-marker-all-docs-nov27` 输出 `openspec-archive: +1 added / ~1 modified / -1 removed`，归档为 `2026-11-27-show-document-end-marker-all-docs-nov27`；`openspec-links` PASS（713 条可达）；修链 `0 处（扫过 4 篇 Markdown / 2 条相对链接）`。
- **归档后审计**：`node scripts/openspec-archive-check.mjs --archived show-document-end-marker-all-docs-nov27` → `PASS（1 条 MODIFIED，对比 10 段；人工恢复 0，声明认领 0）`。
