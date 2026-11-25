# Proposal: Quick Open 高亮项必须等于 Enter 目标

- Change ID: `fix-quick-open-active-target-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已通过**。Alex 2026-11-25 原话「选择器按推荐」，批准按诊断推荐的 Quick
> Open 游标起点行为变化：判决行在真实候选里则高亮它，否则不高亮任何行；Enter 仍直接打开精确路径。
> 视觉基线、样式、另外三个选择器（TOC / Vault / Skill）与目录两段式语义不在批准内。
> 节点 2（归档放行）：**未进行**——本 change 不归档；归档与真机验收由主会话串行安排。

## Why

Quick Open 的结果区与 Enter 消费同一份解析判决（change `quick-open-file-oct23` / `add-quick-open-directory-stable-nov25`），
但**游标起点**与**Enter 目标**在精确路径场景下分叉：`apply()` 恒把游标放到首条真实候选，而
`confirm()` 在用户未主动移动游标时绕过游标直接打开精确路径（`src/quick-open.ts` 的 `apply` /
`confirm`；旧 spec 明文允许该行为）。输入 `plan.md` 同时命中 `notes/plan.md`、`apps/plan.md`、
`plan.md` 时，屏幕高亮 `notes/plan.md`、Enter 却打开 `plan.md`；读屏先听到的 `aria-selected`
也是一条假承诺（`aria-activedescendant` 与动作不一致）。

这是 affordance 冲突而非风格差异：键盘用户依赖「看得见的那一行就是 Enter 会做的事」。诊断的推荐
（选择器合同 `start(空查询)`：判决行在候选里则选它，否则无游标）已被 Alex 批准，本 change 只落这一条。

## What Changes

1. **游标起点由判决形态决定**（新纯函数 `quickOpenStartIndex`）：
   - 判决可打开（`open`）且判决路径是渲染出的真实候选 ⇒ 高亮该行（`path:line` 同样落在它上面）；
   - 判决可打开但判决路径没有对应候选（索引外 / 惰性、vault 外、超出渲染上限）⇒ 不高亮任何行，
     `aria-activedescendant` 缺省，Enter 仍直接打开精确路径；
   - 普通过滤 / 找不到 / 折叠多命中 / 目录语境 ⇒ 首条真实候选（既有语义）；
   - 存在性探测在途、目标未定 ⇒ 不高亮（不先用首行冒充），落地后按上面的规则定位。
2. **Enter 动作前同步游标**：判决由本次按键的探测定下时（在途时按合同不亮），动作之前把游标同步到
   判决行或清空，保证「屏幕上的高亮 = 即将打开的目标」。
3. **机器判据**：纯函数单测（5 条策略矩阵）+ `tests/visual/scenes/quick-open-active-target.spec.ts`
   浏览器矩阵（唯一候选 / 多候选且判决行不在首位 / direct-only / 普通首项 / 移动覆盖默认 / 异步在途
   与落地 / 目录两段式与进入子目录）。
4. **规格增量**：`quick-open` 的「结果区与 Enter 的判决同源」requirement 改写游标条款，新增三个
   场景（判决行不在首位 / 无对应候选行 / 探测在途）。
5. **验收场景同步**（静态检查，真机由主会话串行）：230a / 230b / 230c / 230d / 231 / 874。

## Non-goals

- 不改另外三个选择器（TOC / Vault Switch / Skill 菜单）的游标、ARIA 或 Enter 语义。
- 不改目录进入、lazy 文件、vault 外只读、`path:line` 落点、折叠多命中两段式、异步保位（用户移动后
  按行身份保位）与「不得显示 direct action 伪候选」的既有合同。
- 不改样式、不更新视觉基线、不新增浮层或伪候选视觉行。
- 不 push / merge / archive；不动真机环境。

## Impact

- 影响的 specs：`quick-open`（一条 MODIFIED requirement）。
- 影响的代码：`src/quick-open.ts`（游标起点纯函数、`apply` 起点、`confirm` 动作前同步）。
- 影响的测试：`tests/unit/quick-open.test.ts`（策略矩阵）、新增
  `tests/visual/scenes/quick-open-active-target.spec.ts`（浏览器矩阵）、
  `scripts/acceptance/scenarios/230a|230b|230c|230d|231-quick-open-long-path-width|874`。
- 关联约束：渲染/交互缺陷合同先行（先有不变量条款与属性矩阵）、REVIEW.md「同一语义两处真源」条
  （起点只在 `quickOpenStartIndex` 一处判）、「断言等价于子串」条（矩阵同时读高亮行、ARIA 与打开的
  文档正文）。
