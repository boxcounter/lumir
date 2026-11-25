# Proposal: Quick Open 高亮项必须等于 Enter 目标

- Change ID: `fix-quick-open-active-target-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已通过**。Alex 2026-11-25 原话「选择器按推荐」，批准按诊断推荐的 Quick
> Open 游标起点行为变化：判决行在真实候选里则高亮它，否则不高亮任何行；Enter 仍直接打开精确路径。
> 视觉基线、样式、另外三个选择器（TOC / Vault / Skill）与目录两段式语义不在批准内。
> **未批准项（待 Alex 确认）**：上述批准不覆盖实现代价——「判决未定的每个输入一次存在探测」、
> 「普通查询的高亮延迟 120ms + 一次探测往返」、「未定窗口第一次 ↓ 落首行」。这三条尚待主会话
> 另向 Alex 确认，本文件不把它们写成已批准。
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
   - 找不到 / 折叠多命中 / 目录语境 ⇒ 首条真实候选（既有语义）；
   - **判决未定 ⇒ 一律不高亮**（含普通子串查询）：查询串本身可能就是一条索引外的精确路径，探测
     命中即 Enter 打开它、不命中才落到首行；两者未分之前不先用首行冒充。为此存在性探测对**每个**
     未定判决在去抖窗口后发起一次（普通查询一级、`path:行` 沿既有阶梯至多两级；不是逐键 IPC），
     这份判决由结果区与 Enter 共用（停驻后的 Enter 不再探测），落地后按上面的规则定位——普通搜索
     的「首行 = Enter 目标」在判决明确之后照旧成立。
2. **Enter 动作前同步游标**：判决由本次按键的探测定下时（在途时按合同不亮），动作之前把游标同步到
   判决行或清空，保证「屏幕上的高亮 = 即将打开的目标」。
3. **机器判据**：纯函数单测（「游标起点」6 条 + 「异步补帧的保位」1 条）+ `tests/visual/scenes/quick-open-active-target.spec.ts`
   浏览器矩阵 10 条（唯一候选 / 多候选且判决行不在首位 / direct-only / 普通首项 / 移动覆盖默认 / 异步在途
   与落地 / 角落 / 保位 / 目录两段式与进入子目录）。探测次数同样是判据：普通查询停驻后恰好 1 次、
   停驻后的 Enter 不再新增；`path:行` 沿既有阶梯（本 fixture 为 1 次），Enter 同样不新增。
4. **规格增量**：`quick-open` 的「结果区与 Enter 的判决同源」requirement 改写游标条款。
   living 9 个场景 → delta 12 个：改写 1 个（「直接行与候选行并存时 Enter 打开游标行」）+ 新增 3 个
   （「判决可打开但没有对应候选行」/「探测在途不冒充目标」/「普通查询恰好是索引外精确路径」）。
5. **验收场景同步**（静态检查，真机由主会话串行）：230a / 230b / 230c / 230d / 231 / 874。

## Non-goals

- 不改另外三个选择器（TOC / Vault Switch / Skill 菜单）的游标、ARIA 或 Enter 语义。
- 不改目录进入、lazy 文件、vault 外只读、`path:line` 落点、折叠多命中两段式、异步保位（用户移动后
  按行身份保位）与「不得显示 direct action 伪候选」的既有合同。
- 不改样式、不更新视觉基线、不新增浮层或伪候选视觉行。
- 不 push / merge / archive；不动真机环境。

## 机械核验后的补充（2026-11-25）

机械核验（`.local/reviews/quick-open-active-target-nov25/mechanical.md` §4）指出一个角落：普通查询
恰好是**索引外**文件的精确路径、同时又是其它候选的子串时，渲染先亮首行、Enter 却打开那条索引外
文件——违反「高亮行 = Enter 目标」。该形态不按「现实可忽略」放行，已在本 change 内修掉：

- `undecided` 的游标起点由「探测在途才不亮」改为**一律不亮**；探测改为对每个未定判决发起（去抖
  不变，一次停驻一次探测），落地后再按判决定位。
- `confirm()` 的游标同步从 `open` 分支提到动作之前、对所有判决生效，避免被抑制的游标把「有候选」
  误报成「找不到」。
- `confirm()` 与结果区补帧共用同一输入的判决（已落地复用、在途加入、输入改变才重新探测）：停驻后的
  Enter 不再重复发 `fs_paths_exist`。visual 用精确次数断言钉住（普通查询停驻 1 次、Enter 后仍 1 次；
  `path:行` 沿既有阶梯 1 次、Enter 后仍 1 次）。
- 新增角落的浏览器反例（旧实现红、修后绿）、异步保位与「保位行消失 ⇒ 策略起点」的判别用例。
- spec 增量同步改写「探测只在候选为空 / 带行号后缀时发起」与「普通过滤默认首条」两条措辞。

## Impact

- 影响的 specs：`quick-open`（一条 MODIFIED requirement）。
- 影响的代码：`src/quick-open.ts`（游标起点纯函数、`apply` 起点、`confirm` 动作前同步）。
- 影响的测试：`tests/unit/quick-open.test.ts`（策略矩阵）、新增
  `tests/visual/scenes/quick-open-active-target.spec.ts`（浏览器矩阵）、
  `scripts/acceptance/scenarios/230a|230b|230c|230d|231-quick-open-long-path-width|874`。
- 关联约束：渲染/交互缺陷合同先行（先有不变量条款与属性矩阵）、REVIEW.md「同一语义两处真源」条
  （起点只在 `quickOpenStartIndex` 一处判）、「断言等价于子串」条（矩阵同时读高亮行、ARIA 与打开的
  文档正文）。
