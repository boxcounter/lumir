# Tasks: model-code-pane-workspace-nov27

## 1. 合同与断言先行

- [x] 1.1 新建 proposal / design / spec deltas，记录 Alex 原话「我选择这种模型」与内容模式合同；活跃期不改 living spec。
- [x] 1.2 新增 code pane 结构场景，覆盖满 pane、无阅读手柄、Markdown/块组件不变、长行可达、token 不影响 code、单/双 pane、行号、折行、窄窗、缩放、选区与光标。
- [x] 1.3 改准既有 `content-width.spec.ts` 与 `m281-goto-line.spec.ts` 的 code 几何期望；未实现时逐项取得旧实现红，恢复/实现后取得新实现绿。

## 2. 最小实现

- [x] 2.1 `src/editor.ts`：仅 code grid 改为 gutter 自然宽 + 正文剩余宽，不消费阅读 token；Markdown 分支不变。
- [x] 2.2 `src/main.ts`：手柄显隐按活跃 md/code 与覆盖层同步；复用既有定位、resize、模式/标签/pane 同步和 requestMeasure 路径。
- [x] 2.3 清扫相关代码注释，使其不再描述「code 共享阅读栏/手柄」旧合同；不重构 CM。

## 3. 验收与候选图

- [x] 3.1 更新真机场景 38 的 Markdown 手柄合同，并在合适 code 场景加入无阅读手柄与编辑/切换不破坏断言；更新 COVERAGE 并跑 `--check`。
- [x] 3.2 产出三主题、单/双 pane、行号/折行/窄窗的现状与候选图到主仓 `.local/reviews/code-pane-workspace-nov27/` 并实际看图；Alex 原话「批准代码满 pane 的这张基线」后仅更新授权的 `binding-highlight-chromium-darwin.png`。
- [x] 3.3 浏览器新增/修改断言逐条做反向必红，红/绿命令与结果落 `.local` 证据目录；真机 AX 断言的反向实测随 4.4 执行，不在本项预写。

## 4. 验证与后续门禁

- [x] 4.1 目标 Playwright 场景、`pnpm test`、相关 TypeScript 检查通过。
- [x] 4.2 `scripts/gate.sh quick`、`scripts/docs-check.sh`、OpenSpec `validate --all --strict` 通过，报告照抄 `GATE RESULT` 与退出码。
- [x] 4.3 完整 `gate.sh visual` 在单张授权基线更新后执行：`GATE RESULT: 15/15 PASS（SKIP 0）`、exit 0，1951 passed / 13 skipped；首轮 1950/1/13 历史已保留。
- [x] 4.4 真机由主会话统一跑后，本 worktree 串行复核 38/41 最终 2/2 PASS；41 的 master 同败与时序/oracle 分类、修正和证据均已归档到 `.local` 报告。
- [ ] 4.5 K3 clean/merge 报告已存在但绑定 `a18b3a7b`，Alex 已完成候选图/单张基线过目；最终 oracle/基线提交须取得覆盖最终 tip 的独立复核后才可归档。不 merge、不 push，不预写归档完成。
