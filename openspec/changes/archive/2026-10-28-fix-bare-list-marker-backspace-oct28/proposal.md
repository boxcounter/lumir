# Proposal: 修复裸 marker 行第一次 Backspace 被吞

- Change ID: fix-bare-list-marker-backspace-oct28
- 日期: 2026-10-28
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

段落后紧邻的 `1. ` 是裸 marker 行（lazy continuation），不在语法树的列表项里。Markdown 上游 `deleteMarkupBackward` 对这种行返回 false；替换 marker 的 widget 又使原生退格不产生文档变更。headless Chromium 实测：裸行第一次 Backspace 后文档逐字节不变，第二次才删除；Alex 的真机截图与连续按键反馈进一步确认，在安装版 WKWebView 上连续 Backspace 均无法删除。空行后的真列表第一次即删除。直接调用上游命令的对照结果分别为 false / true。

节点 1：Alex 于 2026-10-28 在上述复现与「第一次退格即删除整个标记、与真列表一致」的修复口径后明确指示「修复」。

## What Changes

- 裸 marker 行的空光标位于内容起点时，Backspace SHALL 单次删除当前 marker 与其后空白，保留引用 / 行首缩进前缀。
- 该分派先于上游 Markdown Backspace；只有裸 marker 行命中，其他上下文继续走上游命令或原生删除。
- 增加命令层、headless Chromium 与真机回归，覆盖第一次按键即生效及既有真列表对照。

## Non-goals

- 不改变真列表 / 引用的上游删除语义、非空选区删除、正文字符删除、Enter 或 TAB 行为。
- 不增加统一键位表命令 id，不为旧中文输入法恢复任何列表输入护栏。
- 不调整 marker widget 的视觉形态或像素基线。

## Impact

- 影响的 specs：editor-live-preview。
- 影响的代码/系统：裸 marker 行命令分派、编辑器内核 Backspace keymap、单测 / 视觉测试与真机场景 153。
- 关联约束：显式编辑动作可改写文档；渲染事件本身仍遵守不改写源文件铁律。

## 节点 2：归档放行

机器 + 独立评审放行，五要件如下：

1. 节点 1 已批准：Alex 2026-10-28「修复」；实现期未扩 scope。
2. 独立 reviewer verdict **clean/merge**，绑定实现 tip `6a510a78262fc4966b05f233e82aeefaf52759e7`，无 P1 / P2；证据 `.local/reviews/list-marker-oct28/reviewer.md`。
3. 实现与验证 tasks 全部完成，仅本归档任务在执行。
4. `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0；最终 quick `GATE RESULT: 13/13 PASS（SKIP 0）` exit 0；真机 153 / 158 2/2 PASS exit 0，证据 `.local/acceptance/2026-10-28/summary.md`。
5. `node scripts/openspec-archive-check.mjs` PASS；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 37/37 PASS；归档跟踪队列本 change 唯一条目。
