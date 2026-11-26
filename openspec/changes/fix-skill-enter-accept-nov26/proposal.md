# Proposal: Skill 候选「高亮即接受」——Enter 新合同

- Change ID: `fix-skill-enter-accept-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（方案裁决 / 节点 1），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：**已批准**。Alex 2026-11-26 对 Enter 新合同的推荐方案原话「认可这个方案」。
> 批准内容即本文「What Changes」六条：菜单有有效高亮时 Enter 接受该 Skill、不要求全名或唯一候选；
> 多候选默认接受当前高亮；无候选才发送、Esc 后 Enter 发送原文；异步 catalog/索引更新不得换项或重开；
> 保留 Shift / Alt / Meta 的非消费语义与 IME 守卫；有效 highlight 必须 armed。
> 节点 2（归档评审）：按 `docs/process/openspec-workflow.md`「节点 2 五要件」由独立评审 + 机器判据放行。

## Why

当前实现把「视觉高亮」与「Enter 是否接受」拆成两个状态：只有 token 前缀逐字等于某个 Skill 全名，
或用户按过方向键 / ⌃N / ⌃P / 移动指针，候选才 `armed`。结果是用户看到唯一或首个候选被高亮、
按 Enter 却发出了一段普通文本（`/tmp` 之于 `tmp-acc`、`/acc` 之于 `acc-skill-abc` 都是这个形态）。
这条口径来自 change `fix-skill-menu-ux-nov25` 的「全名自动接受」增量；Alex 2026-11-26 裁决改为
统一的高亮即接受：**看见哪一项，Enter 就接受哪一项**，全名 / 唯一候选不再是前提。

同时要守住三件事，避免把「接受」扩大成误触：无候选时 Enter 仍是发送（含 Esc 关闭候选之后的原文
发送）；Shift / Alt / Meta 组合与 IME 组合期不被候选吞掉；异步 catalog / 索引回包既不能把用户
已经指向的目标换掉，也不能让旧回包把已关闭的候选重新打开。

## What Changes

- **高亮即 armed**：候选 `items` 非空时 `armed` 恒为真；`data-armed` 保留作观测，但不再出现
  「有游标却没武装」的状态。`skillSelectionSpec` 仍以 armed 为守卫，有效高亮 MUST 可接受。
- **Enter 接受当前高亮**：菜单存在有效高亮项时，无修饰 `Enter` 把 `items[highlighted]` 写入
  composer（`/完整名 ` + 引用），MUST NOT 发送。不要求全名，也不要求候选唯一。
- **默认与显式改变**：打开即按首项 / 按名字保留项 / 全名项高亮；方向键、⌃N / ⌃P 与指针移动改变
  高亮，Enter 接受的始终是当前高亮项。显式导航不再是「武装」的前提，只负责改变高亮。
- **接受/发送的分界**：无候选时 `Enter` 发送普通文本；`Esc` 关闭候选后 `Enter` 发送未改写的原文；
  接受之后再按 `Enter` 才是发送。Shift+Enter 仍换行、Shift+Tab 仍回退焦点、Alt / Meta 组合保持原义。
- **Tab 跟随同一 armed**：Tab 保持既有「接受键」角色（与 Enter 同一接受路径、只认无修饰组合）；
  armed 恒真后，候选打开时 Tab 也接受当前高亮。这条是 armed 口径变化的直接结果，不新增第二套语义。
- **异步稳定**：catalog / 索引回包到达时按**名字**保留当前高亮与接受目标（目标消失才回落首项）；
  回包 MUST NOT 把已接受或已关闭的候选重新打开，MUST NOT 改写 composer 文本或引用。接受动作在
  按键时刻定格目标，晚到回包不得换项。
- IME 守卫不变：组合期不触发 / 不导航 / 不吞确认 Enter，组合开始关闭候选，结束后按最终文档重算一次。

## Non-goals

- 不新增 Skill 语法、搜索排序、环绕导航、多选、预览面板或新键位。
- 不改候选过滤、后端加载、调用策略、权限、草稿或模型行为。
- 不改 wikilink / Quick Open / TOC / Vault 切换器的转移语义；`selector-contract.md` C4 只把本表面
  登记的「高亮 ⇒ armed」写清，其他表面按各自 spec 的登记继续生效。
- 不更新视觉基线；真机 868 由主会话串行执行。

## Impact

- 影响的 specs：`harness` 的「Skill 的混合调用、入口策略与候选交互」由新名「Skill 的混合调用、
  入口策略与候选接受」整条承接（REMOVED + ADDED：旧场景必须改名，openspec 1.12 的 MODIFIED 不允许
  场景改名，按 `fix-skill-menu-ux-nov25` 先例）；「Skill 支持」条内指向旧名的一处交叉引用随 MODIFIED
  改准。发现、策略、权限、引用、留存与投影段落逐字保留。
- 影响的合同：`docs/specs/selector-contract.md` C4（`highlighted` 与 `armed` 的关系）与
  `docs/specs/skill-menu.md`（新增 S5 接受/发送边界与异步稳定）。
- 影响的代码：`src/skill-menu.ts` 的状态转移与注释、`src/harness-panel.ts` 的接受键注释。
- 影响的判据：`tests/unit/skill-menu.test.ts`、`tests/visual/scenes/skill-hybrid.spec.ts`、
  验收场景 `868-harness-skill-menu-ux-nov25` 与 `726-harness-skill-hybrid-invocation`（后者的
  `/tmp` 普通文本路径改为先 Esc 再发送）。
- 关联约束：渲染/交互缺陷合同先行；滚动容器继续归细条档，右缘不放常驻可交互件。
