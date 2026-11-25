# Proposal: 修复 Skill 候选的键盘导航、高亮可见性与响应式宽度

- Change ID: `fix-skill-menu-ux-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（实测报告 / 节点 1 产品意图），AI agent（起草与实现）
- 节点 1: **已批准**。Alex 于 2026-11-25 在 Lumir 0.16.0 实测报告三项缺陷并明确要求安排修复：不支持 Ctrl+N/P 选择、方向键移动高亮但列表不跟随、选择框太小。该报告是本小型缺陷修复的批准依据，不另扩产品 scope。

## Why

Skill 候选当前把 Ctrl+N/P 路由到「关闭候选但不消费」，方向键重绘后没有揭示高亮项，且内容宽与通用 list 档共同把菜单限制在 26em。三条实现分别造成无法按 Emacs 习惯选择、长列表高亮不可见、名称与描述难以扫读。渲染/交互缺陷按合同先行处理，输入分布与可证伪不变量见 [Skill 候选交互合同](../../../../docs/specs/skill-menu.md)。

## What Changes

- 候选打开时，Ctrl+N 与 Ctrl+P 分别和 ArrowDown 与 ArrowUp 共用同一个高亮移动函数；事件被候选消费，不得同时移动 composer 光标或改文档。候选关闭时，既有 Emacs 行移动不变。
- 高亮经键盘或指针改变后，当前项 SHALL 在候选滚动视口内完整可见；已在视口内不滚动，且不得滚动整页或 transcript。到端停住、不环绕的既有语义不变。
- Skill 候选按 composer 宿主可用宽度响应式加宽：短内容取得可用空间驱动的目标宽，长内容可超过旧 26em，但仍受 48em 与 pane 可用宽上限约束。只改 Skill 候选，不改通用 list 浮层的 26em 档。
- 保留 Enter / Tab 接受、被动态不抢 Enter / Tab、Escape 层栈关闭、IME composition 不触发导航且不吞确认 Enter、refs 与发送语义；补两条真实 Tab 按键路径回归。
- 合同核对不改变已批准行为：基线规格只要求带修饰键的同名方向键不被候选消费；旧实现也未消费 Shift+Arrow，原生扩选后经既有 `selectionSet → syncSkillMenu()` 路径在 caret 离开 Skill token 时关闭候选。因此 Shift+Arrow 与 Ctrl+Shift+N/P 均保持「不消费 + 原生扩选 + 候选关闭」，不新增「修饰键后菜单必须保留」的行为。

## Non-goals

- 不新增 Skill 语法、搜索排序、环绕导航、多选、预览面板或新的键位。
- 不改候选过滤、Skill 调用策略、权限、草稿、后端加载或模型行为。
- 不改其它浮层的宽度档、滚动条档或视觉 token；不更新视觉基线。
- 不在本 worker 内启动真机；新增 WKWebView 场景由主会话串行执行。

## Impact

- 影响的 specs：`harness` 的「Skill 的混合调用与入口策略」由新名「Skill 的混合调用、入口策略与候选交互」整条承接（因旧场景必须改名，按 REMOVED + ADDED 通道）。
- 影响的合同：`docs/specs/skill-menu.md`（新增 Skill 专项交互不变量）。
- 影响的代码/系统：composer 捕获键路由、Skill 候选渲染与局部滚动、候选宽度计算及其单元/浏览器/真机场景。
- 关联约束：渲染/交互缺陷合同先行；滚动容器继续归细条档，右缘不放常驻可交互件。

## 归档记录

### 归档前（节点 2 五要件）

1. **节点 1 批准依据**：Alex 2026-11-25 在 Lumir 0.16.0 实测三项缺陷（Ctrl+N/P 不能选择、方向键移动高亮但列表不跟随、选择框过小）并明确要求安排修复；见文首「节点 1」记录。实现期未新增行为裁决。
2. **独立评审**：K3 最终 **clean**（无 P1 / P2 / P3；按节点 2 五要件放行），绑定 tip `d0b6927c82a14a223ac04509219ebd38c7564a00`，报告 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/skill-menu-ux-nov25/k3-final.md`；前序 clean 为 `8d33cabd`。评审列出的 merge/archive 前置（完整 quick / visual、真机 868）已由同一 tip 的完整 gate 与 868 证据补齐；评审后无产品 / 测试改动。
3. **tasks 完成**：`tasks.md` 10/10 全勾；3.4 的真机 868 已完成并记录证据路径（见下）。
4. **门禁与真机证据**：
   - 完整 `bash scripts/gate.sh visual`（含 quick 层）在 `d0b6927c`：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-menu-ux-nov25/gate-visual-final-tip-r2.log`。
   - 真机 868：`868-harness-skill-menu-ux-nov25` **1/1 PASS**、38 断言、0 failed、63.196s；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-skill-menu-ux-r4/`（`results.json`、`summary.md`、`steps.md`、09/10 截图）。
   - `tests/visual/baselines/` 相对基线零改动，未更新基线。
5. **规格对账（归档前读数）**：
   - `node scripts/openspec-archive-check.mjs --change fix-skill-menu-ux-nov25` → `PASS（扫过 1 份 delta，0 条 MODIFIED，对比 0 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目（--change fix-skill-menu-ux-nov25））`。
   - 默认门禁模式 → `PASS（扫过 12 份 delta，16 条 MODIFIED，对比 351 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`。
   - `pnpm exec openspec validate --all --strict` → `39 passed, 0 failed (39 items)`。
   - `bash scripts/docs-check.sh` → `PASS`（含归档对账、队列齐备、backlog 出口与 80 行上限）。
   - `docs/backlog.md` 的归档跟踪队列有且仅有一条本 change 条目；因文件已在 80 行硬上限，按既有先例移除已归档的 `add-harness-skill-slash-invocation-nov23` 旧条目，记录保留在其归档 proposal 与 git 历史。
