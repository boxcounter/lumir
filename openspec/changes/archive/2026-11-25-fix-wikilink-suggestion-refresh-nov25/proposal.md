# Proposal: 恢复 wikilink 候选随原生事务同步刷新

- Change ID: `fix-wikilink-suggestion-refresh-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（0.16.0 实测报告与节点 1 产品意图），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 于 2026-11-25 在 0.16.0 实测报告：输入 `[[` 没有自动出现候选；再输入 `s` 后出现候选，但名称未按 `s` 过滤；删除到只剩 `[` 后候选仍不消失。本 change 以该报告为批准依据，目标是恢复既有已批准候选合同，不重新设计排名、创建文件或接受键行为。

## Why

`openspec/specs/wikilink-suggestion/spec.md` 已要求完整 `[[` 后显示候选、query 随正文更新、opener 不完整时关闭。0.16.0 的原生输入链违反了这些不变量。

基线探针（`.local/missions/wikilink-suggestion-ux-nov25/baseline-internal-readings.json`）记录了真实 query、`OpenState`、items、trigger 与 DOM 顺序：首次打开时 `LinkSuggestView.update → refresh → render → place → coordsAtPos` 在 CodeMirror update 阶段读取布局，产生 `Reading the editor layout isn't allowed during an update`，CodeMirror 随后禁用该插件。后续事务仍更新 `EditorState`，但不再进入候选插件 `update`；存活的原生 `input` 监听又用更新前的 state 重绘上一代 items。新增的原生事务矩阵在旧实现上于 `query=s` 判红，证据为 `baseline-native-contract-test.log`。

## What Changes

- 候选控制器的 trigger、items 与 DOM SHALL 以当前事务后的 `EditorState` 同步；query 改变后不得展示上一代 items，opener 不完整时必须关闭。
- 候选打开后的语法树暂不可用只允许绕过可用性门，不得跳过 trigger 重算、过滤或关闭条件；首次打开仍等允许上下文可判定后展示空 query 候选。
- 布局读取移到 CodeMirror 合法 measure 阶段，避免首次渲染使插件失效；原生输入只经事务 / 语法树 / composition settle 刷新链更新候选，不在 state 更新前重复渲染旧 query。
- 增加普通正文、列表、CJK 前缀、多行文本的原生逐字输入与逐字删除矩阵，保留既有 composition、blur、切标签、切 vault 与接受语义回归。
- 新增真实 WKWebView 场景，覆盖 Alex 报告的完整原生序列；本 worker 只做静态校验，由主会话串行执行真机。

## Non-goals

- 不改变完整路径、实际扩展名、同名歧义与 Rust 唯一往返证书。
- 不改变稳定分层、子串匹配、100 项上限、空态或创建文件语义。
- 不改变 Enter / Tab / 方向键 / ⌃NP / Escape、鼠标接受、IME 冻结与 settle 语义。
- 不新增异步索引、IPC、依赖或持焦输入框，不更新视觉基线。
- 不在本 worker 启动真机，不 push、merge 或 archive。

## Impact

- 影响的 specs：`wikilink-suggestion`。
- 影响的代码/系统：候选插件刷新与渲染生命周期、浏览器交互回归、真机验收场景。
- 关联约束：渲染 / 交互缺陷合同先行；除有效接受外不改写文档或磁盘；真实配置与真实 vault 不访问。

## 节点 2：归档放行记录

机器 + 独立评审放行（本节五要件）；未命中价值 / 行为裁决、审美手感、影响面升级、评审异常或证据缺口例外。

1. **方案已批准**：节点 1 以 Alex 2026-11-25 的 0.16.0 实测报告为依据，目标是恢复既有候选合同；实现未扩展排名、创建文件、接受键或视觉基线范围。
2. **独立 reviewer 结论 clean**：K3 二次复核绑定当前产品 / 测试 tip `b38ba261cc85ca4ac8c826b4cd9edc84b22426a1`，结论 clean，无新增代码级阻塞项。报告中的 merge / archive BLOCKED 仅指当时完整 visual 与真机 867 尚未在该 tip 复跑；两项证据现已按同一 tip 补齐。评审原文：`/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/wikilink-suggestion-refresh-nov25/k3-recheck-2.md`。
3. **tasks 全部完成**：`tasks.md` 10/10 已勾选；3.2 由主会话完成真实 WKWebView 验收并归档证据，无放弃项。
4. **门禁与真机证据通过**：
   - 最终完整门禁：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/wikilink-suggestion-ux-nov25/gate-visual-final-tip.log`。
   - 真机 867：1/1 PASS、31 断言、17.6s；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-wikilink-suggestion-refresh-final/`。
   - 未更新视觉基线，未在本归档阶段重跑真机或完整门禁。
5. **规格对账与记录齐备**：
   - `node scripts/openspec-archive-check.mjs --change fix-wikilink-suggestion-refresh-nov25`：`openspec-archive-check: PASS`（1 份 delta、1 条 MODIFIED、对比 8 段，无静默丢段；本 change 队列条目唯一），exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/wikilink-suggestion-ux-nov25/archive-pre-archive-check.log`。
   - `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：`Totals: 39 passed, 0 failed (39 items)`，exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/wikilink-suggestion-ux-nov25/archive-pre-validate.log`。
   - `bash scripts/docs-check.sh`：`docs-check: PASS`，exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/wikilink-suggestion-ux-nov25/archive-pre-docs-check.log`。
   - `docs/backlog.md` 的归档跟踪队列有且仅有本 change 一条记录。

0.16.0 visual CI 的 Escape 失败是否由本 change 修复，尚未经合并后的 CI 证实；本地 Escape 用例与完整门禁通过不能证明该因果。合并推送后须观察对应 visual workflow，不在本次归档记录中写成已证明。
