# Proposal: Skill 候选浮层恢复为不透底的浮层面

- Change ID: `fix-skill-menu-opaque-background-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（报告 / 裁决），AI agent（起草）

## Why

### 现象

Alex 2026-11-24 报告：**「skill 选择的背景似乎是透明的」**——harness composer 里键入 `/` 唤出的
Skill 候选浮层没有自己的底色，浮层后面的输入区文字与正文读得出来，候选名与底层文字叠在一起。

### 根因（已核实）

`src/harness-panel.css:2746` 的 `.lumir-hp-skill-menu` 写的是
`background: var(--bg-raise, var(--bg))`。这两个 token **在全仓都不存在**：token v1 收敛时
`--bg` 一族被「替换、不留别名」地删除（`src/style.css` 的 token 层文件头注释与
`openspec/specs/ui-design-system/spec.md` 的「设计 token 层」条都写死了这条纪律），而 `--bg-raise`
从未登记过。`var()` 的 fallback 也是同名不存在的 token，于是整条声明在 computed-value 阶段失效，
`background-color` 回落初始值 `transparent`——浮层成了透明底。

现行浮层的统一做法是 `--preview-bg`（三主题均有定值：light `#ffffff` / dark `#26272b` /
eink `#ffffff`），`src/harness-panel.css` 与 `src/style.css` 里其余 20+ 处浮层壳都取它。

### 违反了哪条合同

- `openspec/specs/ui-design-system/spec.md`「设计 token 层」：**浮层壳 SHALL 为 `--preview-bg` +
  1px `--border` + `--shadow-raise`**；界面样式 SHALL 经 token 引用取值，MUST NOT 引用未登记的
  token。
- `docs/specs/design-tokens-v1.md` §使用规则 2：同一份浮层壳配方。

本缺陷不是「哪一档底色更好看」的审美问题，是浮层表面根本不存在——「浮层在内容之上」这条层级
语义在绘制结果上不成立。

### 为什么是现在

用户每次用 `/` 选 Skill 都会撞上（候选与输入区文字重叠，可读性直接受损）；且这是「声明引用了
不存在的 token」这一类缺陷的活样本，用一个有区分度的机器判据钉住它，比逐个浮层肉眼核对更可
持续。

## What Changes

1. **一行 CSS 修复**：`.lumir-hp-skill-menu` 的 `background` 改为 `var(--preview-bg)`。不改尺寸、
   层级（`z-index`）、字体、键位、圆角、边框、阴影，也不动其他任何浮层。

2. **新增 harness 规格条款**（`harness` ADDED「Skill 候选浮层的表面不变量」）：把「候选浮层是
   不透底的 `--preview-bg` 面」写成可证伪的不变量，判据必须落在三主题的计算值与像素上，而不是
   只读 `z-index`。

3. **机器判据**（`tests/visual/scenes/skill-hybrid.spec.ts` 新增三条主题用例，只加不改既有用例）：
   - 计算值：浮层 `background-color` 等于该主题 `--preview-bg` 的写死期望值，且 alpha = 1；
   - 像素：在浮层背后注入高对比文字层，换一套高对比配色后浮层可见面（圆角与边框之内）必须
     逐字节相同——底层文字不穿透；
   - 仪器反证：把浮层背景强制改为 `transparent`，同一对比必须立刻出现差异，证明判据有区分度。

4. **修前先红、修后转绿**：判据先在缺陷态（`var(--bg-raise, var(--bg))`）上跑出三主题全红，
   再落修复转绿。

## Non-goals

- **不改其他浮层**：`--bg-raise` 类残余不在本 change 里清扫（本缺陷的现场只有 Skill 浮层一处）；
- **不新增 token、不加别名**：不补 `--bg-raise` / `--bg`，那会违反 token 层「不留双名」纪律；
- **不动几何与交互**：宽度、落点、`z-index`、字体、键位、候选过滤与选择语义全部不变；
- **不改视觉基线**：本修复不产基线更新（浮层只在交互态出现，不在整页基线里）；
- **不改产品 TS**：修复只在 CSS 一行；
- **不在本 change 内跑真机**：真机复验收口留给主会话的 726 批次（见 tasks）。

## Impact

- 影响的 specs：`harness`（ADDED「Skill 候选浮层的表面不变量」）；活跃期不改 living spec。
- 影响的代码：`src/harness-panel.css` 一行声明。
- 影响的测试：`tests/visual/scenes/skill-hybrid.spec.ts` 新增三条主题用例（既有 9 条不动）。
- 关联约束：`docs/specs/design-tokens-v1.md`（浮层壳配方）、`ui-design-system`「设计 token 层」条；
  视觉门禁分层口径（`tests/visual/README.md`，像素层只在本地判）。
