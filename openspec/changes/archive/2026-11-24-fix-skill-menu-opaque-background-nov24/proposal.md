# Proposal: Skill 候选浮层恢复为不透底的浮层面（含 token 引用链静态防线）

- Change ID: `fix-skill-menu-opaque-background-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（报告 / 裁决 / 全量审计），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：缺陷修复方向由 Alex 2026-11-24 报告「skill 选择的背景似乎是透明的」与本批
> 修复指令（「按缺陷合同修复，只把 Skill 浮层背景改为 `var(--preview-bg)`」）给定，实现期无新增
> 行为裁决；同日 Alex 的全量审计确认这是 Skill 样式里的一簇 token 错引用，并指示把静态防线一并收口。
> 节点 2（归档评审）：独立 reviewer agent-362 **clean / merge**，绑定 tip `37dd4646`，报告
> `.local/reviews/skill-menu-background-r1.md`（非阻塞备注已修：README / tasks 的用例口径与注释项措辞）。
> 归档前证据与归档后读数见文末「归档记录」。

## Why

### 现象

Alex 2026-11-24 报告：**「skill 选择的背景似乎是透明的」**——harness composer 里键入 `/` 唤出的
Skill 候选浮层没有自己的底色，浮层后面的输入区文字与正文读得出来，候选名与底层文字叠在一起。

顺着这条报告做的全量审计（Alex 同日，按 token 名去重）发现：这不是孤例，而是**集中在 Skill
样式里的一簇**——

- `.lumir-hp-skill-menu` 的背景 `var(--bg-raise, var(--bg))`：两个 token 都不存在；
- `.lumir-hp-skill-name` 的 `color: var(--text-1)`：`--text-1` 从未登记过（现行字色档只有
  `--text` / `--text-2` / `--text-3`）；
- 其余候选（`--border-strong` 等）有有效回退或运行时赋值，不是缺陷。

审计结论同时指出：**没有全仓普遍漂移**（102 个使用点、7 个未定义 token，其中 4 个有运行时赋值
或有效回退），但**缺静态防线**——这类「引用一个从未存在的 token」只能靠肉眼审计发现，下一条
同类路径没有任何门禁能拦。

### 根因（已核实）

token v1 收敛时 `--bg` 一族被「替换、不留别名」地删除（`src/style.css` 的 token 层文件头注释与
`openspec/specs/ui-design-system/spec.md` 的「设计 token 层」条都写死了这条纪律），`--bg-raise` /
`--text-1` 则从未登记。`var()` 的 fallback 也是未定义 token 时，整条声明在 computed-value 阶段
失效：背景回落 `transparent`（浮层透明），文字色回落继承（字色档悄悄失效）。

### 违反了哪条合同

- `openspec/specs/ui-design-system/spec.md`「设计 token 层」：界面样式 SHALL 经 token 引用取值，
  MUST NOT 引用未登记的 token；浮层壳 SHALL 为 `--preview-bg` + 1px `--border` +
  `--shadow-raise`。
- `docs/specs/design-tokens-v1.md` §使用规则 2：同一份浮层壳配方。

### 为什么是现在

用户每次用 `/` 选 Skill 都会撞上（候选与输入区文字重叠，可读性直接受损）。更重要的是这一类
缺陷的**检出方式**：现有门禁（视觉像素、真机验收、单测）都只看得见「已经渲染出来的错」，看不见
「CSS 里写了一个不存在的名字」。本 change 除修掉这一簇，还要补上这层静态防线。

## What Changes

1. **两处 token 引用修正**（都在 Skill 样式，各一行）：
   - `.lumir-hp-skill-menu` 的 `background`：`var(--bg-raise, var(--bg))` → `var(--preview-bg)`；
   - `.lumir-hp-skill-name` 的 `color`：`var(--text-1)` → `var(--text)`。
   不改尺寸、层级（`z-index`）、字体、键位、圆角、边框、阴影，也不动其他任何浮层与字色档。

2. **静态防线**（`tests/unit/css-token-references.test.ts`，新文件）：扫描 `src/**/*.css` 的
   定义与全部 `var()` 引用，要求每条引用落到三类归宿之一——CSS 定义、运行时赋值白名单、有效
   回退链。回退必须**求值**：主引用未定义时，回退里的每个 `var()` 都要能解析；`var(--a, var(--b))`
   在两个名字都不存在时判红。运行时白名单只含真实有赋值点的 `--lumir-hp-scale` / `--toc-depth` /
   `--cm-lp-table-columns`，并双向核对（TS 赋值点 + CSS 引用）。

3. **像素判据保留并加宽主题面**（`tests/visual/scenes/skill-hybrid.spec.ts` 的三条主题用例，
   第一批已落）：三主题下浮层底色等于 `--preview-bg` 且 alpha=1、背后文字不穿透、强制透明必须
   见差异。

4. **修前先红、修后转绿**：静态判据先在缺陷态（含 `--text-1`）上真实判红，再落修复转绿。

## Non-goals

- **不做全仓重写 / 不逐个浮层补断言**：审计确认没有普遍漂移，本 change 只收口 Skill 这一簇 +
  一层静态防线；其余浮层不动。
- **不新增 token、不加别名**：不补 `--bg-raise` / `--bg` / `--text-1`，那会违反 token 层「不留
  双名」纪律。
- **不做主题作用域 / 级联分析**：静态判据是「定义存在性 + 回退可解析」判据，不判「某主题下一定
  生效」；也不扫 TS 内联样式（CodeMirror theme 对象、inline style 串）里的引用面。
- **不动几何与交互**：宽度、落点、`z-index`、字体、键位、候选过滤与选择语义全部不变。
- **不改视觉基线**：本修复不产基线更新（浮层只在交互态出现，不在整页基线里）。
- **不改产品 TS**：两处修复都只在 CSS。
- **不在本 change 内跑真机**：真机复验收口留给主会话的 726 批次（见 tasks）。

## Impact

- 影响的 specs：`harness`（ADDED「Skill 候选浮层的表面不变量」）、`ui-design-system`（ADDED
  「CSS token 引用链的静态防线」）；活跃期不改 living spec。
- 影响的代码：`src/harness-panel.css` 两行声明（背景 / 字色），无 TS 改动。
- 影响的测试：`tests/unit/css-token-references.test.ts`（新，含正反例）、
  `tests/visual/scenes/skill-hybrid.spec.ts` 三条主题用例（既有 9 条不动）。
- 关联约束：`docs/specs/design-tokens-v1.md`（浮层壳配方与 token 收敛纪律）、`ui-design-system`
  「设计 token 层」条；视觉门禁分层口径（`tests/visual/README.md`）。

## 归档记录

### 归档前（节点 2 五要件）

1. **节点 1 批准依据**：见文首「评审记录」——缺陷报告 + 修复指令给定方向，实现期无新增行为裁决。
2. **独立评审**：agent-362 **clean / merge**，绑定 tip `37dd4646`，报告
   `.local/reviews/skill-menu-background-r1.md`；三条非阻塞备注（README / tasks 的「空回退」用例口径、
   「注释里的 `var()`」措辞）已在本批改准。
3. **tasks 完成**：`tasks.md` 全部勾选（23/23），真机项按 726 PASS 记录。
4. **门禁与真机证据**：
   - 像素层修前红 / 修后绿：缺陷态三主题全红（失败点为「换掉菜单背后的底色/文字后菜单像素必须不变
     （透底则这里必红）」）→ 修复后 `skill-hybrid.spec.ts` 12/12 绿；
   - 静态层修前红 / 修后绿：`--text-1` 未修时 New test 1 failed / 9 passed
     （`src/harness-panel.css:2772 --text-1：无 CSS 定义、无运行时赋值、无回退`）→ 修复后 10/10 绿；
     全量单测 1951 passed / 0 failed；
   - `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`（exit 0）；
   - `LUMIR_VISUAL_PORT=4392 scripts/gate.sh visual`（含整页 / 元素像素）：`GATE RESULT: 15/15 PASS（SKIP 0）`
     （exit 0），`visual-regression` 912s / 1371 passed；基线未更新；
   - 真机 726：`726-harness-skill-hybrid-invocation` **1/1 PASS**（36 断言、52.6s），证据
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-skill-menu-background/`，
     日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-hybrid-nov24/acceptance-726-background.log`。
     该场景判候选打开 / 选择 / 显式注入的行为面；浮层底色与字色档的机器判据在 chromium 像素层与静态
     token 层，真机截图只有会话清单一张（`shots/01-03-恢复会话清单.jpeg`），未声称真机已逐主题核外观。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs --change fix-skill-menu-opaque-background-nov24`
   → `PASS（扫过 2 份 delta，0 条 MODIFIED，对比 0 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`；
   `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `37 passed, 0 failed`；
   归档跟踪队列在 `docs/backlog.md` 有且仅有一条条目。

### 归档后

- **归档提交**：`a1978439`（归档目录 + 并入后的 living spec 一起提交）。
- **包装器实际输出**：`Change 'fix-skill-menu-opaque-background-nov24' archived as
  '2026-11-24-fix-skill-menu-opaque-background-nov24'.`；`harness: update`（+1 added）、
  `ui-design-system: update`（+1 added），`Totals: + 2, ~ 0, - 0, → 0`——不是纯目录移动。
- **修链读数**：`归档后修链 4 处（扫过 5 篇 Markdown / 6 条相对链接）`，全部在 `design.md`：
  `../../../docs/process/rendering-defect-contract-first.md → ../../../../docs/process/…`、
  `../../specs/ui-design-system/spec.md → ../../../specs/ui-design-system/spec.md`、
  `../../../docs/specs/design-tokens-v1.md → ../../../../docs/specs/design-tokens-v1.md`、
  `../../../scripts/acceptance/scenarios/726-harness-skill-hybrid-invocation.md → ../../../../scripts/acceptance/…`；
  包装器自跑 `openspec-links: PASS（校验 696 条相对链接，全部可达）`。
- **`--archived` 审计**：`PASS（…：0 条 MODIFIED，对比 0 段；人工恢复 0 段，声明认领 0 段）`，
  跑于 2026-11-24T20:57:17+0800。
