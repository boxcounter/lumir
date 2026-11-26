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

## 真机返修（2026-11-26）

首轮真机 868/726 各 1 项失败，均按「先红后绿」处理，不扩大产品合同：

- **A（868，真实产品缺陷）**：WKWebView 在候选滚动 / 重排后会对静止指针补发同坐标 `mousemove`；
  旧实现只认事件目标，滚动把另一行搬到指针下时会把键盘刚选中的游标改回该行（现场：⌃P 到
  `acc-skill-10` 后 Enter 写入 `acc-skill-07`）。修复只改 `mousemove` 判定：`clientX/Y` 相对上次
  变化才算指针选意；真实鼠标移动保持。红测试为 `skill-hybrid.spec.ts` 的静止指针 + 键盘滚动用例。
- **B（726，场景 / 焦点问题，非恢复 bug）**：失败时会话浮层未收起，恢复行 click handler 的
  `setSessPop(false)` 从未执行；该步用坐标 `clickInNode`，运行期前台未取得。且干净 env 下清单只有
  当前会话，恢复当前会话是 `switched=false` 的 no-op，不重建面板，等待的上下文节永远不会出现。
  修复为场景先去新会话再恢复、恢复行改 AXPress 并断言浮层收起；另补 m460 视觉守卫证明恢复 wire
  的上下文节原样上屏。K3 已审的接受键合同不变。

## 归档记录

### 归档前（节点 2 五要件）

1. **方案已批准**：节点 1 为 Alex 2026-11-26「认可这个方案」；实现期 A（WKWebView 同坐标
   `mousemove` 抢游标）是缺陷修复，B（726 恢复等待）是场景/焦点修正，均未扩大接受键合同。
2. **独立评审**：K3 最终 **clean / merge**，绑定 tip `865ff40a`（本轮任务书给出的最终 verdict；
   评审材料由 tower 归档）。评审指出的 proposal / tasks EOF 空行为纯卫生项，已在本提交清理。
3. **tasks 完成**：`tasks.md` 全勾（含 4.1/4.2 返修与 4.3 真机复跑），无放弃项。
4. **门禁与真机证据**：**Alex 2026-11-26 决定本轮只做轻量验证，未跑完整 `scripts/gate.sh` / CI，
   本 change 不声称完整 gate 通过。** 已取得：unit `2049/2049`、`skill-hybrid` 77/77、m460 4/4、
   `docs-check` PASS、`openspec validate --all --strict` 39/39；真机 868/726 **2/2 PASS**，
   日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-enter-accept-nov26/native-868-726-r3.log`
   （726 35.8s / 868 100.8s，两次前台焦点均取得）。视觉基线零改动。
5. **规格对账**：`openspec-archive-check` 门禁模式 PASS（扫过 13 份 delta / 182 段 / 无静默丢段）；
   `validate --all --strict` 39/39；`docs/backlog.md` 归档队列有且仅有一条本 change 条目。

### 归档后

- **归档提交**：`4ce50ceb836a9d9bbd7278794ef968298e8dd316`
  （归档目录 + 并入后的 living spec 一起提交）。
- **包装器实际输出**：`Change 'fix-skill-enter-accept-nov26' archived as
  '2026-11-26-fix-skill-enter-accept-nov26'.`；`harness: update`（`+ 1 added` / `~ 1 modified` /
  `- 1 removed`），`Totals: + 1, ~ 1, - 1, → 0`。
- **修链读数**：`归档后修链 2 处（扫过 3 篇 Markdown / 2 条相对链接）`——归档副本
  `specs/harness/spec.md:5` / `:6` 的 `../../../../../docs/...` → `../../../../../../docs/...`；
  `openspec-links: PASS（校验 707 条相对链接，全部可达）`。
- **归档后审计**：`node scripts/openspec-archive-check.mjs --archived fix-skill-enter-accept-nov26`
  → `PASS（openspec/changes/archive/2026-11-26-fix-skill-enter-accept-nov26：1 条 MODIFIED，
  对比 16 段；人工恢复 0 段，声明认领 0 段）`（2026-11-26）。
- **docs-check**：归档后复跑 PASS（归档队列随 change 离开活跃区自然核销；backlog 保持 80 行上限）。
