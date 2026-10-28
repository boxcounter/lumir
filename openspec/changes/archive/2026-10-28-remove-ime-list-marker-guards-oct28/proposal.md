# Proposal: 移除误报驱动的列表序号输入护栏

- Change ID: remove-ime-list-marker-guards-oct28
- 日期: 2026-10-28
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

有序列表行末 Enter 后出现「2. 3.」曾被归因为 WebKit 原生 smart-list，并先后加上 beforeinput 与 DOM 读回两道拦截。Alex 现已确认：该现象来自当时使用的中文输入法，更换输入法后不再出现，旧报告属于误报。

旧修复从未取得真实输入法事件序列；当时的设计只记录「中文组合态无法自动化复现」，随后以排除法把 WebKit 推定为唯一候选（`openspec/changes/archive/2026-10-15-editor-ordered-list-auto-mode-on-marker/design.md` §1.2）。第二道护栏还会按文本形状吞掉合法编辑：清理前的测试明确把在空列表项内容起点整串插入 `3. 乙项` 判为应丢弃。根因订正后，两道拦截均失去需求依据。

节点 1：Alex 于 2026-10-28 在审计结论「两道护栏都移除、正常列表续行保留」后明确指示「好，请你落实」。

## What Changes

- 移除 md 编辑器对 `insertOrderedList` / `insertUnorderedList` 的 beforeinput 拒收。
- 移除按结果行猜测并丢弃重复 marker 的 DOM inputHandler；正常 DOM 输入恢复交由 CodeMirror 默认读回。
- 删除「IME 组合期不重复插入列表 marker」requirement 及只服务这两道护栏的测试。
- 保留并继续验收正常有序列表续行：行末 Enter 只由编辑器命令产生一个字面下一序号。

## Non-goals

- 不改变正常列表 / 引用续行、空列表项 Enter 退出、裸 marker 行编辑态或 TAB 缩进。
- 不修改 harness composer 的结构化输入拦截；它不是本次误报修复的落点。
- 不回改历史归档提案，不为旧输入法保留兼容层或替代护栏。

## Impact

- 影响的 specs：editor-live-preview。
- 影响的代码/系统：md 编辑器的 DOM 输入装配、列表 marker 解析辅助函数、前端单测 / 视觉测试与真机验收场景。
- 关联约束：直接切断无真实消费者的兼容护栏；不改写源文件铁律与正常编辑行为不变。

## 节点 2：归档放行

机器 + 独立评审放行，五要件如下：

1. 节点 1 已批准：Alex 2026-10-28「好，请你落实」；实现期未扩 scope。
2. 独立 reviewer verdict **clean/merge**，绑定实现 tip `6a510a78262fc4966b05f233e82aeefaf52759e7`，无 P1 / P2；证据 `.local/reviews/list-marker-oct28/reviewer.md`。
3. 实现与验证 tasks 全部完成，仅本归档任务在执行。
4. `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0；最终 quick `GATE RESULT: 13/13 PASS（SKIP 0）` exit 0；真机 153 / 158 2/2 PASS exit 0，证据 `.local/acceptance/2026-10-28/summary.md`。
5. `node scripts/openspec-archive-check.mjs` PASS；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 37/37 PASS；归档跟踪队列本 change 唯一条目。
