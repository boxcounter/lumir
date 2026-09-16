# 真机验收套件设计（2026-09-16 Alex 裁决通过）

- 日期: 2026-09-16
- 角色: Alex Lee（评审/裁决），AI agent（起草/实现）

## Why

AI-only 模式下（ADR 0004）「待真机验收」清单只增不减，全部压在 Alex 人肉——与「极少测试」的流程定位直接冲突。但清单 9 项里约七成是**行为判定**（某键是否触发某行为、某 toast 是否出现、某文件是否 2s 落盘），只有少数是**手感/审美裁决**。行为判定机器全能做：M116 已实证 KimiCU 驱动真实 app 复验的路径可行。缺的不是能力，是把验收从 session 记忆固化成可执行制品。

本提案不改变「美不美、手感好不好归 Alex」的边界（tests/visual/README.md 同一原则），只把行为判定下沉给 agent。

## 设计

**形态**：`scripts/acceptance/` 下每个验收项一个场景文件（markdown 步骤 + 机器断言定义），由一个 runner 约定串起来：

1. `pnpm tauri dev` 起真实 app（WKWebView，非 chromium 近似），加载桌面验收 vault `/tmp/lumir-m102-acceptance`；
2. KimiCU（AX 树 / 截图 / 键盘注入）按场景步骤驱动；
3. 断言分两类：**AX/内容断言**（模式切换、toast 出现、文档内容、磁盘文件落盘轮询）与**截图证据**（留档供 Alex 抽审）；
4. 结果落 `test-results/acceptance/<日期>/`（git 外，与 perf-results 同一惯例）：每场景 PASS/FAIL + 证据截图 + 失败时的 AX dump；摘要表进执行报告（tower review 或 session 汇报）。

**覆盖映射**（backlog「待真机验收」9 项）：

| 验收项 | 归类 |
|---|---|
| 1 Mermaid 点击进源码编辑（含渲染中/失败态） | 可脚本化 |
| 2 公式点击编辑、公式后 Ctrl+B 次数 | 可脚本化 |
| 3 Ctrl+N/P 表格行为 | 可脚本化 |
| 4 表头双击 padding 选中手感 | **Alex 手感** |
| 5 cell 内公式渲染 + 点击编辑 | 渲染与点击可脚本化；手感 Alex |
| 6 Callout 显露、cell 内 `$$`、表格宽度 | 显露/渲染可脚本化；宽度手感 Alex |
| 7 M124 三条恢复路径 | 行为可脚本化；WKWebView 手感 Alex |
| 8 M127 自动保存/暂停/崩溃恢复双动作 | 可脚本化（磁盘轮询断言） |
| 9 Emacs 键位全套、⌘Z 真机路径、[keys] 实操、⌘/ 面板 | 行为可脚本化（⌘Z 是否被视图层级吃掉可判定）；手感 Alex |

**与现有门禁的分工**：tests/visual 守布局/配色/间距像素（chromium 近似、CI 强制）；本套件守**真实 WKWebView 下的行为正确性**（本地 agent 执行、不进 CI v0）。两者不重叠。

## Non-goals

- 不做输入法（IMK）与触控板手感的机器判定——归 Alex。
- 不进 CI（v0）：macos runner 跑真机 Tauri 成本高、失败模式多（tests/visual/README.md 已论证同类 trade-off）；稳定后二期再评。
- 不引入新测试框架/依赖：复用 KimiCU MCP 与既有验收 vault。
- 不替代视觉像素门禁。

## 裁决点

1. **证据是否入 git**：建议不入（截图量大、session 产物），`test-results/acceptance/` 与 perf-results 同惯例；Alex 抽审靠本地目录。备选：摘要表入 `docs/design-parity-contract/evidence/`。
2. **执行时机**：建议 dogfood 批次每次合并后 + Alex 验收前由 agent 先跑一遍，Alex 只看 FAIL 项与手感项。
3. **场景维护权**：新功能 mission 的 tasks 里必须附带「新增/更新验收场景」一项（随实现同 PR），否则套件会腐烂。

## 评审节点（Alex）

- 本设计裁决通过后，实现走 tower mission（建议并入 dogfood 前置批次）；实现完成的验收动作 = 套件跑通 9 项清单中全部「可脚本化」行，FAIL 为零，Alex 只需确认手感项。
