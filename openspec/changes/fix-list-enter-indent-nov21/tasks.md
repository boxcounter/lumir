# Tasks: fix-list-enter-indent-nov21

## 1. 实现

- [x] 1.1 `src/enter-indent.ts`：md 的散文 / 列表续行回落改为裸换行（`insertNewline`），
      只有围栏 / 缩进代码块继续走 `insertNewlineAndIndent`；回落分支显式挡只读会话
- [x] 1.2 `src/enter-indent.ts`：裸行空项退出的删除起点前移到行首缩进之后（保留合法 `>` 引用
      前缀、丢掉纯空白缩进），光标落在删后位置
- [x] 1.3 `src/preview/lists.ts`：`markerTextAt` 把行首前缀拆成 `quote`（`>` 引用）与
      `indent`（空白）两段，仍是一处真源；裸行续行沿用两段原文（行为逐字节不变）
- [x] 1.4 更新模块头 / 行内注释与 `docs/specs/lists.md` B2，使口径与实现一致

## 2. 验证

- [x] 2.1 单测：`tests/unit/enter-indent.test.ts` 覆盖报告矩阵第 7/12 行（无行首空白、光标列 0）
      与第 2/5/6/8 行、代码块、引用的对照；`tests/unit/ordered-list-auto-mode.test.ts` 跟进
      `quote` / `indent` 字段；`node tests/unit/run.mjs` 全绿（1684/1684）
- [x] 2.2 视觉层：`tests/visual/scenes/m264-enter-auto-indent.spec.ts` 断言 doc，
      `tests/visual/scenes/lists.spec.ts` 断言「下一行文本左缘 = 顶层段落左缘」并带
      项内续行 / 真列表 / 围栏 / 引用四组对照；端口 4297 跑通（30/30）；旧源码上两条修复
      判据红、两条对照绿
- [x] 2.3 `pnpm exec tsc --noEmit`、`pnpm exec tsc -p tests/unit/tsconfig.json`、
      `tests/visual` 的 `tsc --noEmit` 三份全绿
- [x] 2.4 `bash scripts/docs-check.sh` 与
      `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 2.5 `node scripts/acceptance/run.mjs --check` 通过（新增场景 269 + 覆盖表重生成）
- [ ] 2.6 真机验收场景 269 由主会话统一执行（本任务不自行跑真机；执行记录落
      `.local/acceptance/`）
