# Proposal: 修正大纲与 vault 选择器的 IME、ARIA 与 Tab 焦点口径

- Change ID: `fix-selector-ime-aria-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（评审 / 裁决），AI agent（诊断与起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-25）。Alex 原话：「选择器按推荐」。
> 批准范围：TOC 与 Vault Switch 的 IME 组合守卫、ARIA 语义修正、Tab 遍历与关闭焦点口径；
> 不包含 Quick Open 初态语义（诊断 P3）、Skill 选中底色（诊断 P4）与任何视觉基线更新——这三项
> 仍待单独裁决。
> 实现期增补（2026-11-25）：用户实测「Vault Switch 与 Outline 的筛选框 `⌘A` 不能全选，Quick
> Open 可以」。Alex 要求在同一 change 内按 Quick Open 的同一输入面合同修复；范围仍限于 TOC /
> Vault 两个筛选框，不新增 capability、不扩到其它表面。
> 诊断依据：四选择器盘点报告（2026-11-25，`.tower` 会话产出；本 proposal 引用的行号已按当前
> 工作树复核）。合同居所 `docs/specs/selector-contract.md` 由并行 change 落地，本 change 只引用
> 该路径、不编辑它，也不在 delta 里复制合同条款。
> 节点 2（归档放行，2026-11-26）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md` 五要件）。
> 1. **方案已批准**：节点 1 Alex 2026-11-25 原话「选择器按推荐」；实现期 ⌘A 增补为同日用户实测缺陷，
>    Alex 要求在同一 change 内按 Quick Open 的总输入面合同修复，范围仍限于 TOC / Vault 两个筛选框，
>    无静默扩 scope。
> 2. **独立 reviewer clean / merge**：**K3 clean / merge**（无新增 P1 / P2 / P3），绑定产品 tip
>    `9b92d42c8e945355338bfda49b3045d839adce14`；后续 `b80d0561`、`d9b85e93` 仅修验收场景 13 断言
>    （test-only，不改产品代码），最终 tip `d9b85e931b0e709d6aa83ddc357c62d11077062e`。机械层报告
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/selector-ime-aria-nov25/mechanical.md`。
> 3. **tasks 完成**：全部勾选（5.4 / 5.5 / 8.5 / 9.6 于本归档批次收口），无放弃项。
> 4. **门禁与真机证据**：最终 tip 完整 `gate visual`（含 quick）原始行 `GATE RESULT: 15/15 PASS（SKIP 0）`、
>    exit 0；visual-regression 1240s；日志
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/selector-accessibility/gate-visual-cmd-a.log`。
>    真机 13-toc **PASS / 65 断言 / 0 失败**、17-multi-vault-switch **PASS / 59 断言 / 0 失败**；⌘A 的
>    `cgevent` 步骤（「⌘A 全选筛选串（真实键盘事件）」→ 一次 Backspace → 「输入框已空」）在两份
>    `steps.md` 里逐条 PASS。证据
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/worktrees/nov25/selector-accessibility/.local/acceptance/2026-11-25/`，
>    耐久副本 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-selector-accessibility-cmd-a-final/`。
>    Alex 原生中文 IME PASS（「IME 通过。」），记录
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-ime-matrix/ledger.md`。
>    未更新视觉基线。
> 5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（扫过 13 份 delta，17 条
>    MODIFIED，对比 383 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）；
>    `openspec validate --all --strict` 39 passed / 0 failed。
> 归档已完成（2026-11-26T07:29:35+0800）：归档提交 `e50c4895`；包装器输出
> `Totals: + 2, ~ 1, - 0, → 0`（toc-outline +1 ADDED / ~1 MODIFIED，vault-workspace +1 ADDED），
> 归档副本修链 **0 处**（扫过 5 篇 Markdown / 0 条相对链接），`openspec-links` **700/700 PASS**；
> `node scripts/openspec-archive-check.mjs --archived fix-selector-ime-aria-nov25` **PASS**
> （1 条 MODIFIED / 对比 24 段 / 人工恢复 0 段 / 声明认领 0 段）；`bash scripts/docs-check.sh` **PASS**
> （同一时间）。归档队列条目在归档前为机器检查落账、归档后按 80 行硬上限核销——`docs/backlog.md`
> 保持 80 行，本条即台账；未改产品代码或视觉基线。

## Why

大纲（TOC）与 vault 切换器是键盘用户的高频表面，当前有三类正确性缺口，均已在代码层复核：

1. **组合期没有防线**：Quick Open 的 keydown 首行有 `event.isComposing || event.keyCode === 229`
   守卫（`src/quick-open.ts:1133`），TOC 与 Vault 没有（`src/toc.ts:710-717`、
   `src/vault-switcher.ts:1503-1510`）。`keyToken` 本身不检查组合态（`src/keys.ts:988-1004`），
   `escapeRouter` 的守卫只覆盖 Escape。于是输入法组合期的 `↓` 会移动游标、`Enter` 会跳转或切换
   vault——中文用户用 `↑↓` / `Enter` 选候选时会被浮层抢走按键。
2. **ARIA 语义混用**：Vault 的 `aria-selected` 表示「当前 vault」（`src/vault-switcher.ts:1195`），
   键盘游标只加 class、不改该属性（`:1441-1455`）；失效行没有 option `id`（`:1201-1206`）。
   读屏听到的「已选中」与实际「按 Enter 会做什么」不是同一件事。
3. **Tab 在 listbox 内遍历原生按钮**：行切换钮与删除钮都是 `<button>`（`:1191`、`:1258`），
   `Tab` 会进入行与删除钮，遍历路径不可预测（还取决于当前行有没有删除钮）。

另有两处同源小缺口：组合结束时 `compositionend` 与紧随的同值 `input` 各刷新一次结果集
（`src/toc.ts:384-394`、`src/vault-switcher.ts:968-978`）；TOC 点浮层外走主动关闭、把焦点拽回
编辑器（`src/toc.ts:404-409`），与 Vault 的被动关闭（`src/vault-switcher.ts:1000-1007`）不一致；
hover 规则用 `--hover` 覆盖了游标行的 `--sel` 底色（`src/style.css:2773-2775`、`:2989-2990`）。

影响面是可访问性与输入法正确性，不是视觉风格；修复不改布局、不改默认当前项策略、不改组件结构。

## What Changes

1. **TOC 的 IME、ARIA 与焦点口径（`toc-outline`）**
   - 就地键在组合期（`isComposing` / `keyCode === 229`）不导航、不接受、不消费；组合结束按最终
     查询串刷新恰一次（同值 `input` 不重复刷新）。
   - `aria-selected` 只表示键盘游标；当前段用 `aria-current` + 既有 `is-current` 标记；option
     `id` 唯一、`aria-activedescendant` 与游标同一条、无游标时移除。
   - 关闭焦点按主动 / 被动区分：`Esc` / 再次触发命令交还编辑器并保持阅读位置；点浮层外 / 焦点
     离开不抢焦点。
   - hover 不清掉游标行的底色与内描边。
2. **Vault 的 IME、ARIA 与 Tab 口径（`vault-workspace`）**
   - 同一条组合期守卫与「组合结束只刷新一次」。
   - `aria-selected` 改为只表示游标；当前 vault 用 `aria-current="true"` + 既有 ✓ / 「当前」flag；
     失效行有唯一 option `id`、`aria-disabled="true"`，但不进游标空间；当前 vault 失效时保留
     `aria-current="true"`（当前身份不因不可用而丢失）；程序化切 vault（`onVaultLoaded`）时
     ✓ / `is-current` / `aria-current` 与移除钮在同一拍跟上，不留视觉与 ARIA 滞后。
   - 行切换钮与删除钮 `tabindex="-1"`，Tab 不被消费；纯键盘删除由 `Delete` / `Backspace` 就地键
     承担（查询为空 + 非当前游标行），沿用既有两步确认、未接管时不消费按键。指针点击、键盘
     `Enter`（切换 / 重定位）与删除的两步确认语义不变。
   - hover 不清掉游标标记；主动关闭交还焦点并保持阅读位置，被动关闭不抢焦点。
3. **输入面的 `⌘A` 全选（`toc-outline` / `vault-workspace` 共用 `quick-open` 的合同）**
   - TOC / Vault 的筛选框是「输入面」：`⌘A` 在输入框持焦时由浮层就地键处理**显式接管**
     （`preventDefault` + 选中输入串），不依赖 webview / 原生 Select All 的默认行为，也不绕到
     `editor.select-all`（那会选中正文、丢掉输入串）；组合期不接管，其余文本编辑键仍走原生路径。
   - 合同本体引用 `quick-open` 的「输入面内的全选（⌘A）」条，不在两个 capability 各写一份。
4. **测试与验收**：先落一份在旧实现上判红的 chromium 矩阵（IME / ARIA / Tab / 焦点 / hover /
   `⌘A`），再实现；验收场景 13（大纲）与 17（vault 切换）补组合期、Tab / 焦点与 `⌘A` 全选步骤，
   真机复跑由主会话串行执行。

## Non-goals

- **不改 Quick Open 的初态语义**（「高亮 ≠ Enter 目标」那条，诊断 P3）：它改变产品承诺，需单独裁决。
- **不改 Skill 菜单**（hover 跟随、Tab 接受、选中底色，诊断 P4）：不在本表面集合内。
- **不统一视觉**：不把游标改成左侧竖条、不合并各表面的 `.is-active` 规则组、不更新视觉基线。
- **不改变默认当前项策略**：TOC 打开仍落在当前段、Vault 打开仍落在当前 vault，查询非空仍落首条命中。
- **不重写组件**：不抽 `SelectableList`、不改浮层壳与布局。
- **不编辑** `docs/specs/selector-contract.md`（并行 change 拥有），delta 只引用该路径。
- **不改键位表**：`↑↓` / `⌃N` / `⌃P` / `Enter` / `Esc` 仍是浮层就地键，不进 `src/keys.ts`。

## Impact

- 影响的 specs：`toc-outline`（MODIFIED「大纲浮层」+ ADDED「浮层选择列表的 IME、ARIA 与焦点
  口径」）、`vault-workspace`（ADDED「vault 列表浮层的 IME、ARIA 与 Tab 口径」）。活跃期不改
  living spec。
- 影响的代码：`src/toc.ts`、`src/vault-switcher.ts`、`src/style.css`（只加两条 hover 例外规则，
  不新增 token / 布局）。
- 影响的测试 / 制品：新增 `tests/visual/scenes/selector-aria-ime-nov25.spec.ts`；更新
  `scripts/acceptance/scenarios/13-toc.md`、`17-multi-vault-switch.md`（覆盖表随场景同步）。
- 关联约束：性能合同（守卫是常数分支、不新建 DOM）；ADR 0003 §3（不写文档）；ADR 0004（AI-only
  交付）；仓库信息卫生（fixture 全为合成数据）。
